begin;

alter table public.hid_migration_projects
 add column if not exists validation_policy jsonb not null default
 '{"qa_sample_rate":0.1,"prevent_self_validation":true,"require_independent_qa":true}'::jsonb;

create table public.hid_migration_validation_tasks(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 source_document_id uuid not null references public.hid_migration_documents(id) on delete cascade,
 extraction_id uuid not null references public.hid_migration_extractions(id),
 status text not null default 'pending' check(status in ('pending','claimed','approved','corrected','rejected','sent_back','cancelled')),
 priority integer not null default 0,
 assigned_staff_account_id uuid references public.hid_staff_accounts(id),
 captured_by_staff_account_id uuid references public.hid_staff_accounts(id),
 lease_owner_staff_account_id uuid references public.hid_staff_accounts(id),
 lease_expires_at timestamptz,
 decided_by_staff_account_id uuid references public.hid_staff_accounts(id),
 decided_at timestamptz,
 decision_version integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(extraction_id)
);

create table public.hid_migration_validation_decisions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 validation_task_id uuid not null references public.hid_migration_validation_tasks(id) on delete cascade,
 version integer not null,
 decision text not null check(decision in ('approved','corrected','rejected','sent_back')),
 corrected_fields jsonb,
 reason text,
 actor_staff_account_id uuid not null references public.hid_staff_accounts(id),
 extraction_hash text not null,
 created_at timestamptz not null default now(),
 unique(validation_task_id,version)
);

create table public.hid_migration_qa_tasks(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 facility_id uuid not null references public.hid_facilities(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 source_document_id uuid not null references public.hid_migration_documents(id) on delete cascade,
 validation_task_id uuid not null references public.hid_migration_validation_tasks(id),
 status text not null default 'pending' check(status in ('pending','claimed','approved','returned','escalated','cancelled')),
 sampling_reason text not null check(sampling_reason in ('random','low_confidence','sensitive_category','manual','policy')),
 lease_owner_staff_account_id uuid references public.hid_staff_accounts(id),
 lease_expires_at timestamptz,
 decided_by_staff_account_id uuid references public.hid_staff_accounts(id),
 decided_at timestamptz,
 decision_version integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(validation_task_id)
);

create table public.hid_migration_qa_decisions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.hid_organizations(id),
 migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
 qa_task_id uuid not null references public.hid_migration_qa_tasks(id) on delete cascade,
 version integer not null,
 decision text not null check(decision in ('approved','returned','escalated')),
 reason text,
 actor_staff_account_id uuid not null references public.hid_staff_accounts(id),
 validation_decision_version integer not null,
 created_at timestamptz not null default now(),
 unique(qa_task_id,version)
);

create index hid_migration_validation_queue_idx on public.hid_migration_validation_tasks(migration_project_id,status,priority desc,created_at);
create index hid_migration_qa_queue_idx on public.hid_migration_qa_tasks(migration_project_id,status,created_at);

create or replace function public.hid_claim_migration_review_task(
 target_task_type text,target_task_id uuid,target_staff_account_id uuid,lease_minutes integer default 15
) returns jsonb language plpgsql security definer set search_path=public as $$
declare row_data jsonb;
begin
 if target_task_type='validation' then
  update hid_migration_validation_tasks set status='claimed',lease_owner_staff_account_id=target_staff_account_id,
   lease_expires_at=now()+make_interval(mins=>least(greatest(lease_minutes,5),60)),updated_at=now()
  where id=target_task_id and status in ('pending','claimed')
   and (lease_expires_at is null or lease_expires_at<now() or lease_owner_staff_account_id=target_staff_account_id)
  returning to_jsonb(hid_migration_validation_tasks.*) into row_data;
 elsif target_task_type='qa' then
  update hid_migration_qa_tasks set status='claimed',lease_owner_staff_account_id=target_staff_account_id,
   lease_expires_at=now()+make_interval(mins=>least(greatest(lease_minutes,5),60)),updated_at=now()
  where id=target_task_id and status in ('pending','claimed')
   and (lease_expires_at is null or lease_expires_at<now() or lease_owner_staff_account_id=target_staff_account_id)
  returning to_jsonb(hid_migration_qa_tasks.*) into row_data;
 else raise exception 'Unsupported review task type';
 end if;
 if row_data is null then raise exception 'Task is already leased or no longer claimable'; end if;
 return row_data;
end $$;

alter table public.hid_migration_validation_tasks enable row level security;
alter table public.hid_migration_validation_decisions enable row level security;
alter table public.hid_migration_qa_tasks enable row level security;
alter table public.hid_migration_qa_decisions enable row level security;
create policy "validation tasks project read" on public.hid_migration_validation_tasks for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "validation decisions project read" on public.hid_migration_validation_decisions for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "qa tasks project read" on public.hid_migration_qa_tasks for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "qa decisions project read" on public.hid_migration_qa_decisions for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
grant select on public.hid_migration_validation_tasks,public.hid_migration_validation_decisions,public.hid_migration_qa_tasks,public.hid_migration_qa_decisions to authenticated;
revoke all on function public.hid_claim_migration_review_task(text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.hid_claim_migration_review_task(text,uuid,uuid,integer) to service_role;

commit;
