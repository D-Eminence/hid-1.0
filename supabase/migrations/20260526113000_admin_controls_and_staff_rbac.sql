begin;

create table if not exists public.hid_platform_controls (
  id boolean primary key default true check (id = true),
  maintenance_mode boolean not null default false,
  patient_signup_enabled boolean not null default true,
  hospital_signup_enabled boolean not null default true,
  patient_portal_enabled boolean not null default true,
  hospital_portal_enabled boolean not null default true,
  break_glass_enabled boolean not null default true,
  uploads_enabled boolean not null default true,
  updated_by_user_profile_id uuid references public.hid_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.hid_platform_controls (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.hid_staff_role_policies (
  role public.hid_staff_role primary key,
  can_open_dashboard boolean not null default true,
  can_use_standard_access boolean not null default true,
  can_view_patient_records boolean not null default true,
  can_create_records boolean not null default true,
  can_use_break_glass boolean not null default true,
  can_view_history boolean not null default true,
  updated_by_user_profile_id uuid references public.hid_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.hid_staff_role_policies (role)
values
  ('doctor'),
  ('nurse'),
  ('lab'),
  ('pharmacist'),
  ('admin')
on conflict (role) do nothing;

drop trigger if exists hid_platform_controls_set_updated_at on public.hid_platform_controls;
create trigger hid_platform_controls_set_updated_at
  before update on public.hid_platform_controls
  for each row execute function public.hid_set_updated_at();

drop trigger if exists hid_staff_role_policies_set_updated_at on public.hid_staff_role_policies;
create trigger hid_staff_role_policies_set_updated_at
  before update on public.hid_staff_role_policies
  for each row execute function public.hid_set_updated_at();

alter table public.hid_platform_controls enable row level security;
alter table public.hid_staff_role_policies enable row level security;

drop policy if exists "hid platform controls platform admin read" on public.hid_platform_controls;
create policy "hid platform controls platform admin read"
  on public.hid_platform_controls
  for select
  to authenticated
  using (public.hid_is_platform_admin());

drop policy if exists "hid platform controls platform admin update" on public.hid_platform_controls;
create policy "hid platform controls platform admin update"
  on public.hid_platform_controls
  for update
  to authenticated
  using (public.hid_is_platform_admin())
  with check (public.hid_is_platform_admin());

drop policy if exists "hid staff role policies platform admin read" on public.hid_staff_role_policies;
create policy "hid staff role policies platform admin read"
  on public.hid_staff_role_policies
  for select
  to authenticated
  using (public.hid_is_platform_admin());

drop policy if exists "hid staff role policies platform admin update" on public.hid_staff_role_policies;
create policy "hid staff role policies platform admin update"
  on public.hid_staff_role_policies
  for update
  to authenticated
  using (public.hid_is_platform_admin())
  with check (public.hid_is_platform_admin());

create or replace function public.hid_before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  email_value text := lower(coalesce(event -> 'user' ->> 'email', ''));
  requested_role text := coalesce(event -> 'user' -> 'user_metadata' ->> 'requested_role', 'patient');
  domain_value text := split_part(email_value, '@', 2);
  hospital_name_value text := nullif(trim(coalesce(event -> 'user' -> 'user_metadata' -> 'pending_staff_onboarding' ->> 'hospitalName', '')), '');
  state_value text := nullif(trim(coalesce(event -> 'user' -> 'user_metadata' -> 'pending_staff_onboarding' ->> 'state', '')), '');
  country_value text := nullif(trim(coalesce(event -> 'user' -> 'user_metadata' -> 'pending_staff_onboarding' ->> 'country', '')), '');
  admin_created_platform_admin boolean := coalesce((event -> 'user' -> 'app_metadata' ->> 'admin_created_platform_admin')::boolean, false);
  controls_row public.hid_platform_controls;
begin
  select *
  into controls_row
  from public.hid_platform_controls
  where id = true;

  if requested_role = 'platform_admin' then
    if not admin_created_platform_admin then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Platform admin accounts must be created by an existing HID admin.'));
    end if;

    if email_value = '' then
      return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'Platform admin accounts must use email sign-up.'));
    end if;

    return '{}'::jsonb;
  end if;

  if coalesce(controls_row.maintenance_mode, false) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 503, 'message', 'HID is under scheduled maintenance right now. Please try again shortly.'));
  end if;

  if requested_role = 'patient' and not coalesce(controls_row.patient_signup_enabled, true) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Patient sign-up is disabled right now.'));
  end if;

  if requested_role in ('clinician', 'org_admin') and not coalesce(controls_row.hospital_signup_enabled, true) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Hospital sign-up is disabled right now.'));
  end if;

  if requested_role in ('clinician', 'org_admin', 'platform_admin') and email_value = '' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'Staff accounts must use email sign-up.'));
  end if;

  if requested_role = 'org_admin' then
    if hospital_name_value is null or state_value is null or country_value is null then
      return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'Hospital name, state, and country are required.'));
    end if;

    return '{}'::jsonb;
  end if;

  if requested_role = 'clinician' then
    if not exists (
      select 1
      from public.hid_allowed_staff_domains
      where domain = domain_value
        and active = true
    ) then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Staff sign-up is invite-only.'));
    end if;
  end if;

  return '{}'::jsonb;
end;
$$;

commit;
