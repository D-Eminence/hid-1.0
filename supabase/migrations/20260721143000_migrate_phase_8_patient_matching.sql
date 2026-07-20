begin;

alter table public.hid_migration_source_folders add column if not exists version integer not null default 1 check(version>0);

alter table public.hid_patient_identifiers drop constraint if exists hid_patient_identifiers_identifier_type_check;
alter table public.hid_patient_identifiers add constraint hid_patient_identifiers_identifier_type_check
 check(identifier_type in ('hid_code','phone','email','hospital_number','legacy_folder_number','card_number','file_number','registration_number'));
alter table public.hid_patient_identifiers
 add column if not exists organization_id uuid references public.hid_organizations(id),
 add column if not exists facility_id uuid references public.hid_facilities(id),
 add column if not exists source_system text,
 add column if not exists issuer text;
alter table public.hid_patient_identifiers drop constraint if exists hid_patient_identifiers_identifier_type_normalized_value_key;
create unique index if not exists hid_patient_identifier_global_unique
 on public.hid_patient_identifiers(identifier_type,normalized_value)
 where identifier_type in ('hid_code','phone','email');
create unique index if not exists hid_patient_identifier_tenant_unique
 on public.hid_patient_identifiers(organization_id,coalesce(facility_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(source_system,''),identifier_type,normalized_value)
 where identifier_type in ('hospital_number','legacy_folder_number','card_number','file_number','registration_number');

create table public.hid_migration_match_candidates(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 source_folder_id uuid not null references public.hid_migration_source_folders(id) on delete cascade,
 source_version integer not null,
 patient_id uuid not null references public.hid_patients(id),
 score numeric not null check(score between 0 and 1),
 band text not null check(band in ('exact','strong','possible','weak')),
 features jsonb not null,
 conflicts jsonb not null default '[]'::jsonb,
 masked_patient_snapshot jsonb not null,
 created_at timestamptz not null default now(),
 unique(source_folder_id,source_version,patient_id)
);
create table public.hid_migration_match_decisions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 source_folder_id uuid not null references public.hid_migration_source_folders(id) on delete cascade,
 source_version integer not null,
 decision text not null check(decision in ('link_existing','create_new_pending','review_later','escalate')),
 patient_id uuid references public.hid_patients(id),
 candidate_id uuid references public.hid_migration_match_candidates(id),
 reason text,
 actor_staff_account_id uuid not null references public.hid_staff_accounts(id),
 revoked_at timestamptz,
 revoked_by_staff_account_id uuid references public.hid_staff_accounts(id),
 created_at timestamptz not null default now(),
 check((decision='link_existing' and patient_id is not null) or (decision<>'link_existing' and patient_id is null))
);
create unique index hid_migration_one_final_match on public.hid_migration_match_decisions(source_folder_id,source_version) where revoked_at is null;
create index hid_migration_match_candidates_queue on public.hid_migration_match_candidates(migration_project_id,source_folder_id,score desc);
alter table public.hid_migration_match_candidates enable row level security;
alter table public.hid_migration_match_decisions enable row level security;
create policy "match candidates project read" on public.hid_migration_match_candidates for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "match decisions project read" on public.hid_migration_match_decisions for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
grant select on public.hid_migration_match_candidates,public.hid_migration_match_decisions to authenticated;

commit;
