begin;

alter table public.hid_medical_records
 add column if not exists source_provenance jsonb,
 add column if not exists structured_schema_version text;
alter table public.hid_medical_record_files
 add column if not exists source_asset_id uuid references public.hid_migration_assets(id),
 add column if not exists immutable_source boolean not null default false;

create table public.hid_migration_mapping_templates(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid references public.hid_facilities(id),
 migration_project_id uuid references public.hid_migration_projects(id) on delete cascade,
 name text not null,schema_name text not null,schema_version text not null,mapping jsonb not null,
 active boolean not null default true,
 created_by_staff_account_id uuid not null references public.hid_staff_accounts(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.hid_migration_import_jobs(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 mapping_template_id uuid references public.hid_migration_mapping_templates(id),
 status text not null default 'queued' check(status in ('queued','running','partially_succeeded','succeeded','failed','cancelled','verification_failed')),
 idempotency_key text not null,
 requested_by_staff_account_id uuid not null references public.hid_staff_accounts(id),
 total_items integer not null default 0,succeeded_items integer not null default 0,failed_items integer not null default 0,
 created_at timestamptz not null default now(),started_at timestamptz,finished_at timestamptz,updated_at timestamptz not null default now(),
 unique(migration_project_id,idempotency_key)
);
create table public.hid_migration_import_items(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 import_job_id uuid not null references public.hid_migration_import_jobs(id) on delete cascade,
 source_folder_id uuid not null references public.hid_migration_source_folders(id),
 source_version integer not null,
 match_decision_id uuid not null references public.hid_migration_match_decisions(id),
 patient_id uuid references public.hid_patients(id),
 actor_staff_account_id uuid references public.hid_staff_accounts(id),
 status text not null default 'ready' check(status in ('ready','importing','imported','failed','verification_failed','cancelled','blocked_identity')),
 idempotency_key text not null,
 attempt_count integer not null default 0,
 target_record_ids uuid[] not null default '{}',
 last_error_code text,last_error_message text,
 imported_at timestamptz,verified_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(migration_project_id,idempotency_key),
 unique(source_folder_id,source_version)
);
create index hid_migration_import_items_job_status on public.hid_migration_import_items(import_job_id,status,created_at);

create or replace function public.hid_execute_migration_import_item(
 target_item_id uuid,actor_profile_id uuid,actor_staff_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare item hid_migration_import_items%rowtype;doc record;record_id uuid;version_id uuid;asset record;record_ids uuid[]:='{}';fields jsonb;category text;
begin
 select * into item from hid_migration_import_items where id=target_item_id for update;
 if not found then raise exception 'Import item not found'; end if;
 if item.status='imported' then return jsonb_build_object('item_id',item.id,'record_ids',item.target_record_ids,'idempotent',true); end if;
 if item.patient_id is null then
  update hid_migration_import_items set status='blocked_identity',last_error_code='IDENTITY_NOT_CANONICAL',last_error_message='An approved canonical patient is required.',updated_at=now() where id=item.id;
  return jsonb_build_object('item_id',item.id,'status','blocked_identity');
 end if;
 update hid_migration_import_items set status='importing',actor_staff_account_id=actor_staff_id,attempt_count=attempt_count+1,updated_at=now() where id=item.id;
 for doc in
  select d.id,d.document_reference,d.title,e.document_category,e.schema_name,e.schema_version,
   coalesce(vd.corrected_fields,e.fields) as import_fields
  from hid_migration_documents d
  join lateral(select * from hid_migration_extractions x where x.source_document_id=d.id order by version desc limit 1)e on true
  join hid_migration_validation_tasks vt on vt.extraction_id=e.id and vt.status in('approved','corrected')
  left join lateral(select corrected_fields from hid_migration_validation_decisions where validation_task_id=vt.id order by version desc limit 1)vd on true
  where d.source_folder_id=item.source_folder_id
   and not exists(select 1 from hid_migration_qa_tasks qt where qt.validation_task_id=vt.id and qt.status<>'approved')
 loop
  fields:=doc.import_fields;category:=doc.document_category;
  insert into hid_medical_records(patient_id,title,category,info_type,source_provenance,structured_schema_version,created_by_user_profile_id,created_by_staff_account_id)
  values(item.patient_id,coalesce(doc.title,replace(category,'_',' ')),category,
   case category when 'laboratory_result' then 'lab_result' when 'prescription' then 'medication' else 'document' end,
   jsonb_build_object('migration_project_id',item.migration_project_id,'source_folder_id',item.source_folder_id,'source_document_id',doc.id,'import_item_id',item.id),
   doc.schema_name||':'||doc.schema_version,actor_profile_id,actor_staff_id) returning id into record_id;
  insert into hid_medical_record_versions(record_id,version_no,record,notes,structured_data,created_by_user_profile_id,created_by_staff_account_id)
  values(record_id,1,'Imported from validated source document '||doc.document_reference,'HID Migrate verified import',fields,actor_profile_id,actor_staff_id) returning id into version_id;
  update hid_medical_records set current_version_id=version_id where id=record_id;
  for asset in select * from hid_migration_assets where source_document_id=doc.id and asset_kind='original' and status='accepted' loop
   insert into hid_medical_record_files(record_id,record_version_id,patient_id,storage_bucket,storage_path,original_file_name,mime_type,size_bytes,sha256_hex,uploaded_by_user_profile_id,source_asset_id,immutable_source)
   values(record_id,version_id,item.patient_id,asset.storage_bucket,asset.storage_path,asset.original_file_name,asset.mime_type,asset.size_bytes,asset.sha256_hex,actor_profile_id,asset.id,true)
   on conflict(storage_path) do nothing;
  end loop;
  record_ids:=array_append(record_ids,record_id);
 end loop;
 if cardinality(record_ids)=0 then raise exception 'No approved validated documents are ready for import'; end if;
 update hid_migration_import_items set status='imported',actor_staff_account_id=actor_staff_id,target_record_ids=record_ids,imported_at=now(),last_error_code=null,last_error_message=null,updated_at=now() where id=item.id;
 return jsonb_build_object('item_id',item.id,'record_ids',record_ids,'idempotent',false);
exception when others then
 update hid_migration_import_items set status='failed',actor_staff_account_id=actor_staff_id,last_error_code=sqlstate,last_error_message=left(sqlerrm,500),updated_at=now() where id=target_item_id;
 return jsonb_build_object('item_id',target_item_id,'status','failed','error_code',sqlstate);
end $$;

alter table public.hid_migration_mapping_templates enable row level security;
alter table public.hid_migration_import_jobs enable row level security;
alter table public.hid_migration_import_items enable row level security;
create policy "mapping templates project read" on public.hid_migration_mapping_templates for select to authenticated using(migration_project_id is null or public.hid_has_migration_project_access(migration_project_id));
create policy "import jobs project read" on public.hid_migration_import_jobs for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "import items project read" on public.hid_migration_import_items for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
grant select on public.hid_migration_mapping_templates,public.hid_migration_import_jobs,public.hid_migration_import_items to authenticated;
revoke all on function public.hid_execute_migration_import_item(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.hid_execute_migration_import_item(uuid,uuid,uuid) to service_role;

commit;
