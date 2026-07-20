begin;
alter table public.hid_migration_jobs drop constraint if exists hid_migration_jobs_job_type_check;
alter table public.hid_migration_jobs add constraint hid_migration_jobs_job_type_check
 check(job_type in ('security_scan','image_process','ocr','classify','extract'));

create table public.hid_migration_classifications(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 source_document_id uuid not null references public.hid_migration_documents(id) on delete cascade,
 job_id uuid not null references public.hid_migration_jobs(id),
 version integer not null,
 selected_category text not null check(selected_category in ('consultation','laboratory_result','prescription','admission','discharge_summary','radiology_report','referral','insurance_document','hmo_document','billing_document','consent','attachment','other','unclassified')),
 candidates jsonb not null,
 confidence numeric check(confidence between 0 and 1),
 provider text not null,model text not null,prompt_version text not null,schema_version text not null,
 created_at timestamptz not null default now(),unique(source_document_id,version)
);
create table public.hid_migration_extractions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 source_document_id uuid not null references public.hid_migration_documents(id) on delete cascade,
 classification_id uuid references public.hid_migration_classifications(id),
 job_id uuid not null references public.hid_migration_jobs(id),
 version integer not null,document_category text not null,schema_name text not null,schema_version text not null,
 provider text not null,model text not null,prompt_version text not null,
 fields jsonb not null,overall_confidence numeric check(overall_confidence between 0 and 1),
 created_at timestamptz not null default now(),unique(source_document_id,version)
);
comment on column public.hid_migration_extractions.fields is 'Schema-bound fields; each field must include value, confidence and source page/span coordinates.';
alter table public.hid_migration_classifications enable row level security;
alter table public.hid_migration_extractions enable row level security;
create policy "migration classifications project read" on public.hid_migration_classifications for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "migration extractions project read" on public.hid_migration_extractions for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
grant select on public.hid_migration_classifications,public.hid_migration_extractions to authenticated;
commit;
