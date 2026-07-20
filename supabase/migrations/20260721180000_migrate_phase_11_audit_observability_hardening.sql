begin;

alter table public.hid_migration_projects add column if not exists command_idempotency_key text;
alter table public.hid_migration_batches add column if not exists command_idempotency_key text;
alter table public.hid_migration_work_assignments add column if not exists command_idempotency_key text;
create unique index if not exists migration_project_command_idempotency on public.hid_migration_projects(created_by_staff_account_id,command_idempotency_key) where command_idempotency_key is not null;
create unique index if not exists migration_batch_command_idempotency on public.hid_migration_batches(created_by_staff_account_id,command_idempotency_key) where command_idempotency_key is not null;
create unique index if not exists migration_assignment_command_idempotency on public.hid_migration_work_assignments(created_by_staff_account_id,command_idempotency_key) where command_idempotency_key is not null;

alter table public.hid_migration_import_items drop constraint if exists hid_migration_import_items_status_check;
alter table public.hid_migration_import_items add constraint hid_migration_import_items_status_check
 check(status in ('ready','importing','imported','failed','verification_failed','cancelled','blocked_identity','correction_required'));

create or replace function public.hid_create_migration_page(
 p_organization_id uuid,p_facility_id uuid,p_project_id uuid,p_folder_id uuid,p_document_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare page_row hid_migration_pages%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_document_id::text,0));
 insert into hid_migration_pages(organization_id,facility_id,migration_project_id,source_folder_id,source_document_id,page_number)
 select p_organization_id,p_facility_id,p_project_id,p_folder_id,p_document_id,coalesce(max(page_number),0)+1
 from hid_migration_pages where source_document_id=p_document_id
 returning * into page_row;
 return to_jsonb(page_row);
end $$;
revoke all on function public.hid_create_migration_page(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.hid_create_migration_page(uuid,uuid,uuid,uuid,uuid) to service_role;

create table public.hid_migration_correction_cases(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 source_folder_id uuid not null references public.hid_migration_source_folders(id),
 import_item_id uuid references public.hid_migration_import_items(id),
 case_type text not null check(case_type in ('wrong_patient','wrong_attachment','clinical_data','duplicate_identity')),
 status text not null default 'open' check(status in ('open','frozen','remediating','verified','closed','cancelled')),
 reason text not null,
 opened_by_staff_account_id uuid not null references public.hid_staff_accounts(id),
 closed_by_staff_account_id uuid references public.hid_staff_accounts(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),closed_at timestamptz
);
create table public.hid_migration_cost_events(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 job_id uuid references public.hid_migration_jobs(id),
 provider text not null,service text not null,
 unit text not null,quantity numeric not null check(quantity>=0),unit_cost_minor numeric not null check(unit_cost_minor>=0),
 currency char(3) not null default 'USD',metadata jsonb not null default '{}',
 occurred_at timestamptz not null default now()
);

create or replace function public.hid_validate_migration_row_tenant()
returns trigger language plpgsql set search_path=public as $$
declare p record;
begin
 if new.migration_project_id is null then return new; end if;
 select organization_id,facility_id into p from hid_migration_projects where id=new.migration_project_id;
 if p is null or new.organization_id<>p.organization_id
  or (to_jsonb(new)?'facility_id' and (to_jsonb(new)->>'facility_id')::uuid<>p.facility_id) then
  raise exception 'Migration resource tenant scope does not match its project.';
 end if;
 return new;
end $$;

do $$
declare table_name text;
begin
 foreach table_name in array array[
  'hid_migration_batches','hid_migration_scan_sessions','hid_migration_source_folders','hid_migration_documents',
  'hid_migration_pages','hid_migration_assets','hid_migration_jobs','hid_migration_ocr_results',
  'hid_migration_classifications','hid_migration_extractions','hid_migration_validation_tasks',
  'hid_migration_qa_tasks','hid_migration_match_candidates','hid_migration_match_decisions',
  'hid_migration_import_jobs','hid_migration_import_items','hid_migration_correction_cases','hid_migration_cost_events'
 ] loop
  execute format('drop trigger if exists %I on public.%I','migration_tenant_consistency',table_name);
  execute format('create trigger %I before insert or update of organization_id,facility_id,migration_project_id on public.%I for each row execute function public.hid_validate_migration_row_tenant()','migration_tenant_consistency',table_name);
 end loop;
end $$;

create or replace function public.hid_prevent_migration_history_mutation()
returns trigger language plpgsql as $$ begin raise exception 'Migration decision and evidence history is append-only.';end $$;
create trigger validation_decisions_immutable before update or delete on public.hid_migration_validation_decisions for each row execute function public.hid_prevent_migration_history_mutation();
create trigger qa_decisions_immutable before update or delete on public.hid_migration_qa_decisions for each row execute function public.hid_prevent_migration_history_mutation();
create trigger classifications_immutable before update or delete on public.hid_migration_classifications for each row execute function public.hid_prevent_migration_history_mutation();
create trigger extractions_immutable before update or delete on public.hid_migration_extractions for each row execute function public.hid_prevent_migration_history_mutation();
create trigger ocr_results_immutable before update or delete on public.hid_migration_ocr_results for each row execute function public.hid_prevent_migration_history_mutation();

create or replace function public.hid_audit_migration_mutation()
returns trigger language plpgsql security definer set search_path=public as $$
declare payload jsonb:=to_jsonb(new);staff_id uuid;staff_auth_id uuid;staff_profile_id uuid;action_name text;
begin
 staff_id:=coalesce(
  nullif(payload->>'actor_staff_account_id','')::uuid,
  nullif(payload->>'requested_by_staff_account_id','')::uuid,
  nullif(payload->>'opened_by_staff_account_id','')::uuid,
  nullif(payload->>'decided_by_staff_account_id','')::uuid
 );
 if staff_id is not null then select auth_user_id,user_profile_id into staff_auth_id,staff_profile_id from hid_staff_accounts where id=staff_id;end if;
 action_name:=case
  when tg_table_name='hid_migration_import_items' then 'import_item_'||coalesce(payload->>'status','updated')
  when tg_table_name='hid_migration_correction_cases' then 'correction_case_'||coalesce(payload->>'status','updated')
  else coalesce(payload->>'decision',lower(tg_op))
 end;
 insert into hid_audit_events(actor_user_id,actor_profile_id,actor_role,patient_id,organization_id,resource_type,resource_id,action,metadata)
 values(staff_auth_id,staff_profile_id,'clinician',
  nullif(payload->>'patient_id','')::uuid,nullif(payload->>'organization_id','')::uuid,
  replace(tg_table_name,'hid_',''),nullif(payload->>'id','')::uuid,action_name,
  jsonb_build_object('migration_project_id',payload->>'migration_project_id','source_folder_id',payload->>'source_folder_id','version',coalesce(payload->>'version',payload->>'source_version')));
 return new;
end $$;
create trigger audit_validation_decision after insert on public.hid_migration_validation_decisions for each row execute function public.hid_audit_migration_mutation();
create trigger audit_qa_decision after insert on public.hid_migration_qa_decisions for each row execute function public.hid_audit_migration_mutation();
create trigger audit_match_decision after insert on public.hid_migration_match_decisions for each row execute function public.hid_audit_migration_mutation();
create trigger audit_import_item after insert or update of status on public.hid_migration_import_items for each row execute function public.hid_audit_migration_mutation();
create trigger audit_correction_case after insert or update of status on public.hid_migration_correction_cases for each row execute function public.hid_audit_migration_mutation();

create or replace view public.hid_migration_project_operations with (security_invoker=true) as
select p.id as migration_project_id,p.organization_id,p.facility_id,
 (select count(*) from hid_migration_source_folders f where f.migration_project_id=p.id) as folders,
 (select count(*) from hid_migration_pages pg where pg.migration_project_id=p.id) as pages,
 (select count(*) from hid_migration_jobs j where j.migration_project_id=p.id and j.status='queued') as jobs_queued,
 (select count(*) from hid_migration_jobs j where j.migration_project_id=p.id and j.status='dead_letter') as jobs_dead_letter,
 (select count(*) from hid_migration_validation_tasks vt where vt.migration_project_id=p.id and vt.status in('pending','claimed')) as validation_open,
 (select count(*) from hid_migration_qa_tasks qt where qt.migration_project_id=p.id and qt.status in('pending','claimed')) as qa_open,
 (select count(*) from hid_migration_import_items ii where ii.migration_project_id=p.id and ii.status='imported') as imports_completed,
 (select count(*) from hid_migration_import_items ii where ii.migration_project_id=p.id and ii.status in('failed','verification_failed')) as imports_failed,
 (select coalesce(sum(ce.quantity*ce.unit_cost_minor),0) from hid_migration_cost_events ce where ce.migration_project_id=p.id) as cost_minor
from hid_migration_projects p
;

alter table public.hid_migration_correction_cases enable row level security;
alter table public.hid_migration_cost_events enable row level security;
create policy "correction cases project read" on public.hid_migration_correction_cases for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "cost events project read" on public.hid_migration_cost_events for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
grant select on public.hid_migration_correction_cases,public.hid_migration_cost_events,public.hid_migration_project_operations to authenticated;

commit;
