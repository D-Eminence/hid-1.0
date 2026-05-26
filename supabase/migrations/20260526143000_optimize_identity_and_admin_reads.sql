create index if not exists idx_hid_user_profiles_app_role_created_at
  on public.hid_user_profiles(app_role, created_at desc);

create or replace function public.hid_resolve_patient_identity_state(p_identifier text)
returns table (
  auth_user_id uuid,
  auth_email text,
  auth_phone text,
  patient_id uuid,
  user_profile_id uuid,
  hid_code text,
  full_name text,
  phone text,
  email text,
  profile_active boolean,
  profile_deleted boolean,
  patient_deleted boolean
)
language sql
security definer
set search_path = public, auth
as $$
  with normalized as (
    select
      trim(coalesce(p_identifier, '')) as raw_identifier,
      upper(trim(coalesce(p_identifier, ''))) as upper_identifier,
      regexp_replace(trim(coalesce(p_identifier, '')), '[^0-9+]', '', 'g') as phone_identifier,
      lower(trim(coalesce(p_identifier, ''))) as lower_identifier
  ),
  candidate as (
    select identifiers.patient_id, 1 as priority
    from normalized
    join public.hid_patient_identifiers identifiers
      on identifiers.identifier_type = 'hid_code'
     and identifiers.normalized_value = normalized.upper_identifier
    where normalized.raw_identifier <> ''
      and normalized.upper_identifier like 'HID-%'

    union all

    select identifiers.patient_id, 2 as priority
    from normalized
    join public.hid_patient_identifiers identifiers
      on identifiers.identifier_type = 'phone'
     and identifiers.normalized_value = normalized.phone_identifier
    where normalized.phone_identifier <> ''

    union all

    select identifiers.patient_id, 3 as priority
    from normalized
    join public.hid_patient_identifiers identifiers
      on identifiers.identifier_type = 'email'
     and identifiers.normalized_value = normalized.lower_identifier
    where normalized.lower_identifier <> ''
  ),
  target as (
    select candidate.patient_id
    from candidate
    order by candidate.priority asc
    limit 1
  )
  select
    patients.auth_user_id,
    auth_users.email::text as auth_email,
    auth_users.phone::text as auth_phone,
    patients.id as patient_id,
    patients.user_profile_id,
    patients.hid_code,
    patients.full_name,
    patients.phone_e164 as phone,
    patients.email::text as email,
    coalesce(profiles.active, true) as profile_active,
    (profiles.deleted_at is not null) as profile_deleted,
    (patients.deleted_at is not null) as patient_deleted
  from target
  join public.hid_patients patients on patients.id = target.patient_id
  left join public.hid_user_profiles profiles on profiles.id = patients.user_profile_id
  left join auth.users auth_users on auth_users.id = patients.auth_user_id;
$$;

revoke all on function public.hid_resolve_patient_identity_state(text) from public, anon, authenticated;
grant execute on function public.hid_resolve_patient_identity_state(text) to service_role;

create or replace function public.hid_list_platform_admin_accounts()
returns table (
  profile_id uuid,
  auth_user_id uuid,
  display_name text,
  email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  active boolean,
  mfa_required boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  select
    profiles.id as profile_id,
    profiles.auth_user_id,
    profiles.display_name,
    auth_users.email::text as email,
    auth_users.email_confirmed_at,
    auth_users.last_sign_in_at,
    profiles.active,
    profiles.mfa_required,
    profiles.created_at,
    profiles.updated_at
  from public.hid_user_profiles profiles
  left join auth.users auth_users on auth_users.id = profiles.auth_user_id
  where profiles.app_role = 'platform_admin'
  order by profiles.created_at asc;
$$;

revoke all on function public.hid_list_platform_admin_accounts() from public, anon, authenticated;
grant execute on function public.hid_list_platform_admin_accounts() to service_role;
