begin;
do $$ begin
 create type public.hid_migration_job_status as enum ('queued','leased','running','succeeded','retry_scheduled','dead_letter','cancelled');
exception when duplicate_object then null; end $$;

create table public.hid_migration_jobs(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 source_folder_id uuid references public.hid_migration_source_folders(id) on delete cascade,
 source_document_id uuid references public.hid_migration_documents(id) on delete cascade,
 page_id uuid references public.hid_migration_pages(id) on delete cascade,
 asset_id uuid references public.hid_migration_assets(id) on delete cascade,
 job_type text not null check(job_type in ('security_scan','image_process','ocr')),
 status public.hid_migration_job_status not null default 'queued',
 payload_version integer not null default 1,
 payload jsonb not null default '{}',
 idempotency_key text not null,
 provider text,
 attempt_count integer not null default 0,
 max_attempts integer not null default 5 check(max_attempts between 1 and 20),
 available_at timestamptz not null default now(),
 leased_by text,
 lease_expires_at timestamptz,
 heartbeat_at timestamptz,
 last_error_code text,
 last_error_message text,
 correlation_id uuid not null default gen_random_uuid(),
 started_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(migration_project_id,idempotency_key)
);
create index on public.hid_migration_jobs(status,available_at,created_at) where status in ('queued','retry_scheduled');
create index on public.hid_migration_jobs(migration_project_id,status,created_at desc);

create table public.hid_migration_page_quality(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 page_id uuid not null references public.hid_migration_pages(id) on delete cascade,
 source_asset_id uuid not null references public.hid_migration_assets(id),
 derived_asset_id uuid references public.hid_migration_assets(id),
 algorithm_version text not null,
 blur_score numeric check(blur_score between 0 and 1),
 blank_score numeric check(blank_score between 0 and 1),
 crop_score numeric check(crop_score between 0 and 1),
 resolution_dpi integer,
 duplicate_of_page_id uuid references public.hid_migration_pages(id),
 needs_rescan boolean not null default false,
 reasons text[] not null default '{}',
 created_at timestamptz not null default now()
);

create table public.hid_migration_ocr_results(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 source_document_id uuid not null references public.hid_migration_documents(id) on delete cascade,
 page_id uuid not null references public.hid_migration_pages(id) on delete cascade,
 source_asset_id uuid not null references public.hid_migration_assets(id),
 job_id uuid not null references public.hid_migration_jobs(id),
 version integer not null,
 provider text not null,
 provider_model text not null,
 provider_request_id text,
 language_codes text[] not null default '{}',
 normalized_text text not null,
 blocks jsonb not null default '[]',
 tables jsonb not null default '[]',
 confidence numeric check(confidence between 0 and 1),
 raw_result_storage_path text,
 latency_ms integer check(latency_ms is null or latency_ms>=0),
 page_cost_minor bigint check(page_cost_minor is null or page_cost_minor>=0),
 created_at timestamptz not null default now(),
 unique(page_id,version)
);

alter table public.hid_migration_jobs enable row level security;
alter table public.hid_migration_page_quality enable row level security;
alter table public.hid_migration_ocr_results enable row level security;
create policy "migration jobs project read" on public.hid_migration_jobs for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "migration quality project read" on public.hid_migration_page_quality for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "migration ocr project read" on public.hid_migration_ocr_results for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
grant select on public.hid_migration_jobs,public.hid_migration_page_quality,public.hid_migration_ocr_results to authenticated;

create or replace function public.hid_migration_claim_jobs(p_worker text,p_job_types text[],p_limit integer default 10,p_lease_seconds integer default 120)
returns setof public.hid_migration_jobs language plpgsql security definer set search_path=public as $$
begin
 return query
 with candidates as(
  select id from public.hid_migration_jobs
  where job_type=any(p_job_types) and (
   (status in ('queued','retry_scheduled') and available_at<=now())
   or (status in ('leased','running') and lease_expires_at<now())
  )
  order by available_at,created_at for update skip locked limit least(greatest(p_limit,1),50)
 ), updated as(
  update public.hid_migration_jobs job set status='leased',leased_by=p_worker,
   lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,30),900)),
   heartbeat_at=now(),attempt_count=attempt_count+1,updated_at=now()
  from candidates where job.id=candidates.id returning job.*
 ) select * from updated;
end $$;
revoke all on function public.hid_migration_claim_jobs(text,text[],integer,integer) from public,anon,authenticated;
grant execute on function public.hid_migration_claim_jobs(text,text[],integer,integer) to service_role;
commit;
