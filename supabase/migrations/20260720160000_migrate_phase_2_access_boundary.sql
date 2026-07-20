begin;

do $$
begin
  create type public.hid_migration_role as enum (
    'migration_administrator',
    'project_manager',
    'medical_records_officer',
    'scanner_operator',
    'validation_officer',
    'qa_reviewer'
  );
exception
  when duplicate_object then null;
end $$;

alter table public.hid_platform_controls
  add column if not exists migrate_portal_enabled boolean not null default false;

create table if not exists public.hid_migration_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hid_organizations(id) on delete restrict,
  facility_id uuid not null references public.hid_facilities(id) on delete restrict,
  project_reference text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_reference)
);

comment on table public.hid_migration_projects is
  'Phase 2 project security boundary only. Project lifecycle and management arrive in Phase 3.';

create table if not exists public.hid_migration_project_members (
  id uuid primary key default gen_random_uuid(),
  migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
  staff_account_id uuid not null references public.hid_staff_accounts(id) on delete cascade,
  staff_membership_id uuid not null references public.hid_staff_memberships(id) on delete cascade,
  migration_role public.hid_migration_role not null,
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  unique (migration_project_id, staff_account_id)
);

create index if not exists idx_hid_migration_project_members_staff
  on public.hid_migration_project_members(staff_account_id, active, migration_project_id);

create or replace function public.hid_validate_migration_project_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  project_row public.hid_migration_projects%rowtype;
  membership_row public.hid_staff_memberships%rowtype;
begin
  select * into project_row
  from public.hid_migration_projects
  where id = new.migration_project_id;

  select * into membership_row
  from public.hid_staff_memberships
  where id = new.staff_membership_id;

  if project_row.id is null or membership_row.id is null then
    raise exception 'Migration project and staff membership are required.';
  end if;

  if membership_row.staff_account_id <> new.staff_account_id
    or membership_row.organization_id <> project_row.organization_id
    or (membership_row.facility_id is not null and membership_row.facility_id <> project_row.facility_id)
  then
    raise exception 'Migration project member scope does not match the active HID staff membership.';
  end if;

  return new;
end;
$$;

drop trigger if exists hid_validate_migration_project_scope on public.hid_migration_project_members;
create trigger hid_validate_migration_project_scope
before insert or update on public.hid_migration_project_members
for each row execute function public.hid_validate_migration_project_scope();

drop trigger if exists hid_migration_projects_set_updated_at on public.hid_migration_projects;
create trigger hid_migration_projects_set_updated_at
before update on public.hid_migration_projects
for each row execute function public.hid_set_updated_at();

drop trigger if exists hid_migration_project_members_set_updated_at on public.hid_migration_project_members;
create trigger hid_migration_project_members_set_updated_at
before update on public.hid_migration_project_members
for each row execute function public.hid_set_updated_at();

create or replace function public.hid_migration_role_capabilities(role_value public.hid_migration_role)
returns text[]
language sql
immutable
strict
as $$
  select case role_value
    when 'migration_administrator' then array[
      'project.read', 'project.manage', 'member.manage', 'assignment.manage',
      'capture.write', 'processing.retry', 'validation.decide', 'qa.decide',
      'match.decide', 'import.execute', 'report.read', 'audit.read'
    ]
    when 'project_manager' then array[
      'project.read', 'project.manage', 'member.manage', 'assignment.manage',
      'capture.write', 'processing.retry', 'validation.decide', 'match.decide',
      'import.execute', 'report.read', 'audit.read'
    ]
    when 'medical_records_officer' then array[
      'project.read', 'assignment.manage', 'capture.write', 'processing.retry',
      'validation.decide', 'match.decide', 'report.read'
    ]
    when 'scanner_operator' then array[
      'project.read', 'capture.write', 'report.read_own'
    ]
    when 'validation_officer' then array[
      'project.read', 'validation.decide', 'match.decide_assigned', 'report.read_own'
    ]
    when 'qa_reviewer' then array[
      'project.read', 'qa.decide', 'match.decide_escalated', 'report.read_qa'
    ]
  end
$$;

create or replace function public.hid_has_migration_project_access(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hid_migration_project_members project_member
    join public.hid_migration_projects project
      on project.id = project_member.migration_project_id
    join public.hid_staff_accounts staff
      on staff.id = project_member.staff_account_id
    join public.hid_staff_memberships membership
      on membership.id = project_member.staff_membership_id
    join public.hid_organizations organization
      on organization.id = project.organization_id
    join public.hid_facilities facility
      on facility.id = project.facility_id
    where project.id = target_project_id
      and staff.auth_user_id = auth.uid()
      and staff.active
      and staff.deleted_at is null
      and membership.active
      and membership.staff_account_id = staff.id
      and membership.organization_id = project.organization_id
      and (membership.facility_id is null or membership.facility_id = project.facility_id)
      and project_member.active
      and project_member.starts_at <= now()
      and (project_member.ends_at is null or project_member.ends_at > now())
      and project.active
      and organization.active
      and facility.active
      and facility.organization_id = project.organization_id
  )
$$;

create or replace function public.hid_has_migration_capability(
  target_project_id uuid,
  required_capability text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hid_migration_project_members project_member
    where project_member.migration_project_id = target_project_id
      and project_member.staff_account_id = public.hid_current_staff_account_id()
      and required_capability = any(public.hid_migration_role_capabilities(project_member.migration_role))
      and public.hid_has_migration_project_access(target_project_id)
  )
$$;

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
      select jsonb_agg(
        jsonb_build_object(
          'id', project.id,
          'project_reference', project.project_reference,
          'name', project.name,
          'organization_id', project.organization_id,
          'organization_name', organization.name,
          'facility_id', project.facility_id,
          'facility_name', facility.name,
          'migration_role', project_member.migration_role,
          'capabilities', public.hid_migration_role_capabilities(project_member.migration_role)
        )
        order by project.name, project.id
      )
      from public.hid_migration_project_members project_member
      join public.hid_migration_projects project
        on project.id = project_member.migration_project_id
      join public.hid_organizations organization on organization.id = project.organization_id
      join public.hid_facilities facility on facility.id = project.facility_id
      where project_member.staff_account_id = public.hid_current_staff_account_id()
        and public.hid_has_migration_project_access(project.id)
    ), '[]'::jsonb)
  )
$$;

alter table public.hid_migration_projects enable row level security;
alter table public.hid_migration_project_members enable row level security;

drop policy if exists "migration projects assigned read" on public.hid_migration_projects;
create policy "migration projects assigned read"
on public.hid_migration_projects
for select
to authenticated
using (public.hid_has_migration_project_access(id));

drop policy if exists "migration project members assigned read" on public.hid_migration_project_members;
create policy "migration project members assigned read"
on public.hid_migration_project_members
for select
to authenticated
using (public.hid_has_migration_project_access(migration_project_id));

revoke all on function public.hid_migration_role_capabilities(public.hid_migration_role) from public;
revoke all on function public.hid_has_migration_project_access(uuid) from public;
revoke all on function public.hid_has_migration_capability(uuid, text) from public;
revoke all on function public.hid_get_my_migration_context() from public;

grant execute on function public.hid_migration_role_capabilities(public.hid_migration_role) to authenticated;
grant execute on function public.hid_has_migration_project_access(uuid) to authenticated;
grant execute on function public.hid_has_migration_capability(uuid, text) to authenticated;
grant execute on function public.hid_get_my_migration_context() to authenticated;
grant select on public.hid_migration_projects to authenticated;
grant select on public.hid_migration_project_members to authenticated;

commit;
