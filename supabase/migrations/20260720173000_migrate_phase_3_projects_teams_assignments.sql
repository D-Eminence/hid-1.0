begin;

do $$
begin
  create type public.hid_migration_project_status as enum (
    'draft', 'active', 'paused', 'completed', 'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.hid_migration_batch_status as enum (
    'draft', 'open', 'closed', 'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.hid_migration_assignment_status as enum (
    'pending', 'in_progress', 'completed', 'cancelled'
  );
exception when duplicate_object then null;
end $$;

alter table public.hid_migration_projects
  add column if not exists status public.hid_migration_project_status not null default 'draft',
  add column if not exists description text,
  add column if not exists record_location text,
  add column if not exists estimated_patients integer not null default 0 check (estimated_patients >= 0),
  add column if not exists estimated_folders integer not null default 0 check (estimated_folders >= 0),
  add column if not exists start_date date,
  add column if not exists expected_completion date,
  add column if not exists completed_at timestamptz,
  add column if not exists created_by_staff_account_id uuid references public.hid_staff_accounts(id) on delete restrict;

alter table public.hid_migration_projects
  drop constraint if exists hid_migration_projects_dates_check;
alter table public.hid_migration_projects
  add constraint hid_migration_projects_dates_check
  check (expected_completion is null or start_date is null or expected_completion >= start_date);

create index if not exists idx_hid_migration_projects_scope_status
  on public.hid_migration_projects(organization_id, facility_id, status, created_at desc);

create or replace function public.hid_validate_migration_project_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.hid_facilities facility
    where facility.id = new.facility_id
      and facility.organization_id = new.organization_id
      and facility.active
  ) then
    raise exception 'Migration project facility must belong to the selected active organization.';
  end if;
  return new;
end;
$$;

drop trigger if exists hid_migration_projects_validate_tenant on public.hid_migration_projects;
create trigger hid_migration_projects_validate_tenant
before insert or update of organization_id, facility_id on public.hid_migration_projects
for each row execute function public.hid_validate_migration_project_tenant();

create or replace function public.hid_validate_migration_project_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  project_row public.hid_migration_projects%rowtype;
  membership_row public.hid_staff_memberships%rowtype;
  staff_row public.hid_staff_accounts%rowtype;
begin
  select * into project_row from public.hid_migration_projects where id = new.migration_project_id;
  select * into membership_row from public.hid_staff_memberships where id = new.staff_membership_id;
  select * into staff_row from public.hid_staff_accounts where id = new.staff_account_id;

  if project_row.id is null or membership_row.id is null or staff_row.id is null
    or not membership_row.active or not staff_row.active or staff_row.deleted_at is not null then
    raise exception 'Active migration project, staff account and HID membership are required.';
  end if;
  if membership_row.staff_account_id <> new.staff_account_id
    or membership_row.organization_id <> project_row.organization_id
    or (membership_row.facility_id is not null and membership_row.facility_id <> project_row.facility_id) then
    raise exception 'Migration project member scope does not match the HID staff membership.';
  end if;
  return new;
end;
$$;

create table if not exists public.hid_migration_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hid_organizations(id) on delete restrict,
  facility_id uuid not null references public.hid_facilities(id) on delete restrict,
  migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
  batch_reference text not null,
  name text not null,
  description text,
  estimated_folders integer not null default 0 check (estimated_folders >= 0),
  status public.hid_migration_batch_status not null default 'draft',
  created_by_staff_account_id uuid not null references public.hid_staff_accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (migration_project_id, batch_reference)
);

create table if not exists public.hid_migration_work_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hid_organizations(id) on delete restrict,
  facility_id uuid not null references public.hid_facilities(id) on delete restrict,
  migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
  migration_batch_id uuid references public.hid_migration_batches(id) on delete cascade,
  assigned_to_project_member_id uuid not null references public.hid_migration_project_members(id) on delete cascade,
  title text not null,
  description text,
  priority smallint not null default 3 check (priority between 1 and 5),
  status public.hid_migration_assignment_status not null default 'pending',
  due_at timestamptz,
  created_by_staff_account_id uuid not null references public.hid_staff_accounts(id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hid_migration_command_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_staff_account_id uuid not null references public.hid_staff_accounts(id) on delete cascade,
  idempotency_key text not null,
  action text not null,
  response_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (actor_staff_account_id, idempotency_key)
);

create or replace function public.hid_get_my_migration_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'staff_account_id', public.hid_current_staff_account_id(),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', project.id, 'project_reference', project.project_reference, 'name', project.name,
        'organization_id', project.organization_id, 'organization_name', organization.name,
        'facility_id', project.facility_id, 'facility_name', facility.name,
        'migration_role', project_member.migration_role,
        'capabilities', public.hid_migration_role_capabilities(project_member.migration_role)
      ) order by project.name, project.id)
      from public.hid_migration_project_members project_member
      join public.hid_migration_projects project on project.id = project_member.migration_project_id
      join public.hid_organizations organization on organization.id = project.organization_id
      join public.hid_facilities facility on facility.id = project.facility_id
      where project_member.staff_account_id = public.hid_current_staff_account_id()
        and public.hid_has_migration_project_access(project.id)
    ), '[]'::jsonb),
    'creation_scopes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organization_id', organization.id, 'organization_name', organization.name,
        'facility_id', facility.id, 'facility_name', facility.name,
        'staff_membership_id', membership.id
      ) order by organization.name, facility.name)
      from public.hid_staff_memberships membership
      join public.hid_organizations organization on organization.id = membership.organization_id
      join public.hid_facilities facility
        on facility.organization_id = organization.id
       and (membership.facility_id is null or facility.id = membership.facility_id)
      where membership.staff_account_id = public.hid_current_staff_account_id()
        and membership.active
        and (
          membership.app_role = 'org_admin'
          or exists (
            select 1
            from public.hid_migration_project_members administrator_assignment
            join public.hid_migration_projects administrator_project
              on administrator_project.id = administrator_assignment.migration_project_id
            where administrator_assignment.staff_account_id = membership.staff_account_id
              and administrator_assignment.migration_role = 'migration_administrator'
              and administrator_assignment.active
              and administrator_project.organization_id = membership.organization_id
          )
        )
        and organization.active and facility.active
    ), '[]'::jsonb)
  )
$$;

create index if not exists idx_hid_migration_batches_project
  on public.hid_migration_batches(migration_project_id, created_at desc);
create index if not exists idx_hid_migration_assignments_project
  on public.hid_migration_work_assignments(migration_project_id, status, priority, created_at desc);
create index if not exists idx_hid_migration_assignments_member
  on public.hid_migration_work_assignments(assigned_to_project_member_id, status, due_at);

create or replace function public.hid_validate_migration_child_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  project_row public.hid_migration_projects%rowtype;
  batch_row public.hid_migration_batches%rowtype;
  member_row public.hid_migration_project_members%rowtype;
begin
  select * into project_row from public.hid_migration_projects where id = new.migration_project_id;
  if project_row.id is null
    or new.organization_id <> project_row.organization_id
    or new.facility_id <> project_row.facility_id then
    raise exception 'Migration child resource scope must match its project.';
  end if;

  if tg_table_name = 'hid_migration_work_assignments' then
    select * into member_row from public.hid_migration_project_members
      where id = new.assigned_to_project_member_id;
    if member_row.id is null or member_row.migration_project_id <> new.migration_project_id then
      raise exception 'Assignment owner must be a member of the same migration project.';
    end if;
    if new.migration_batch_id is not null then
      select * into batch_row from public.hid_migration_batches where id = new.migration_batch_id;
      if batch_row.id is null or batch_row.migration_project_id <> new.migration_project_id then
        raise exception 'Assignment batch must belong to the same migration project.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists hid_migration_batches_validate_scope on public.hid_migration_batches;
create trigger hid_migration_batches_validate_scope
before insert or update on public.hid_migration_batches
for each row execute function public.hid_validate_migration_child_scope();

drop trigger if exists hid_migration_assignments_validate_scope on public.hid_migration_work_assignments;
create trigger hid_migration_assignments_validate_scope
before insert or update on public.hid_migration_work_assignments
for each row execute function public.hid_validate_migration_child_scope();

drop trigger if exists hid_migration_batches_set_updated_at on public.hid_migration_batches;
create trigger hid_migration_batches_set_updated_at before update on public.hid_migration_batches
for each row execute function public.hid_set_updated_at();
drop trigger if exists hid_migration_assignments_set_updated_at on public.hid_migration_work_assignments;
create trigger hid_migration_assignments_set_updated_at before update on public.hid_migration_work_assignments
for each row execute function public.hid_set_updated_at();

alter table public.hid_migration_batches enable row level security;
alter table public.hid_migration_work_assignments enable row level security;

create policy "migration batches assigned project read"
on public.hid_migration_batches for select to authenticated
using (public.hid_has_migration_project_access(migration_project_id));

create policy "migration assignments assigned project read"
on public.hid_migration_work_assignments for select to authenticated
using (public.hid_has_migration_project_access(migration_project_id));

grant select on public.hid_migration_batches to authenticated;
grant select on public.hid_migration_work_assignments to authenticated;

comment on table public.hid_migration_projects is
  'Tenant-scoped HID Migrate project. Phase 3 owns lifecycle and operational estimates.';
comment on table public.hid_migration_batches is
  'Logical project batch only; scan sessions and source assets begin in Phase 4.';
comment on table public.hid_migration_work_assignments is
  'Project or batch work ownership. Folder/task-specific assignment targets arrive with their owning phases.';

commit;
