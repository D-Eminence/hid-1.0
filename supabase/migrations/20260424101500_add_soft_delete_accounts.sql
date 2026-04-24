alter table public.hid_user_profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_reason text,
  add column if not exists deleted_by_user_profile_id uuid references public.hid_user_profiles(id) on delete set null,
  add column if not exists restored_at timestamptz,
  add column if not exists restored_by_user_profile_id uuid references public.hid_user_profiles(id) on delete set null;

alter table public.hid_patients
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_reason text,
  add column if not exists restored_at timestamptz;

alter table public.hid_staff_accounts
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_reason text,
  add column if not exists restored_at timestamptz;

create index if not exists idx_hid_user_profiles_deleted_at
  on public.hid_user_profiles(deleted_at desc)
  where deleted_at is not null;

create index if not exists idx_hid_patients_deleted_at
  on public.hid_patients(deleted_at desc)
  where deleted_at is not null;

create index if not exists idx_hid_staff_accounts_deleted_at
  on public.hid_staff_accounts(deleted_at desc)
  where deleted_at is not null;

create or replace function public.hid_current_user_profile_id()
returns uuid
language sql
stable
as $$
  select id
  from public.hid_user_profiles
  where auth_user_id = auth.uid()
    and active = true
    and deleted_at is null
  limit 1
$$;

create or replace function public.hid_current_patient_id()
returns uuid
language sql
stable
as $$
  select patient.id
  from public.hid_patients patient
  join public.hid_user_profiles profile
    on profile.id = patient.user_profile_id
  where patient.auth_user_id = auth.uid()
    and patient.deleted_at is null
    and profile.active = true
    and profile.deleted_at is null
  limit 1
$$;

create or replace function public.hid_current_staff_account_id()
returns uuid
language sql
stable
as $$
  select staff.id
  from public.hid_staff_accounts staff
  join public.hid_user_profiles profile
    on profile.id = staff.user_profile_id
  where staff.auth_user_id = auth.uid()
    and staff.active = true
    and staff.deleted_at is null
    and profile.active = true
    and profile.deleted_at is null
  limit 1
$$;

create or replace function public.hid_current_app_role()
returns public.hid_app_role
language sql
stable
as $$
  select app_role
  from public.hid_user_profiles
  where auth_user_id = auth.uid()
    and active = true
    and deleted_at is null
  limit 1
$$;

create or replace function public.hid_soft_delete_account_by_auth_user_id(
  p_auth_user_id uuid,
  p_reason text default null,
  p_actor_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.hid_user_profiles;
  patient_row public.hid_patients;
  staff_row public.hid_staff_accounts;
  deleted_at_value timestamptz := now();
  reason_value text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Account deleted');
begin
  select *
  into profile_row
  from public.hid_user_profiles
  where auth_user_id = p_auth_user_id
  limit 1;

  if profile_row.id is null then
    return jsonb_build_object('deleted', false);
  end if;

  if profile_row.app_role = 'platform_admin' then
    raise exception 'Platform admin accounts cannot be deleted here.';
  end if;

  if profile_row.deleted_at is not null then
    return jsonb_build_object(
      'deleted', false,
      'already_deleted', true,
      'deleted_at', profile_row.deleted_at
    );
  end if;

  select *
  into patient_row
  from public.hid_patients
  where auth_user_id = p_auth_user_id
  limit 1;

  select *
  into staff_row
  from public.hid_staff_accounts
  where auth_user_id = p_auth_user_id
  limit 1;

  if patient_row.id is not null then
    update public.hid_access_grants
    set
      status = 'revoked',
      revoked_at = coalesce(revoked_at, deleted_at_value),
      revoked_by_user_profile_id = coalesce(revoked_by_user_profile_id, p_actor_profile_id),
      revoked_reason = coalesce(revoked_reason, reason_value)
    where patient_id = patient_row.id
      and status = 'active';

    update public.hid_access_requests
    set
      status = 'denied',
      denied_at = coalesce(denied_at, deleted_at_value),
      denied_reason = coalesce(denied_reason, reason_value)
    where patient_id = patient_row.id
      and status = 'pending';

    update public.hid_patients
    set
      deleted_at = deleted_at_value,
      deleted_reason = reason_value,
      restored_at = null,
      updated_at = now()
    where id = patient_row.id;
  end if;

  if staff_row.id is not null then
    update public.hid_access_grants
    set
      status = 'revoked',
      revoked_at = coalesce(revoked_at, deleted_at_value),
      revoked_by_user_profile_id = coalesce(revoked_by_user_profile_id, p_actor_profile_id),
      revoked_reason = coalesce(revoked_reason, reason_value)
    where staff_account_id = staff_row.id
      and status = 'active';

    update public.hid_access_requests
    set
      status = 'denied',
      denied_at = coalesce(denied_at, deleted_at_value),
      denied_reason = coalesce(denied_reason, reason_value)
    where requester_staff_account_id = staff_row.id
      and status = 'pending';

    update public.hid_staff_accounts
    set
      active = false,
      deleted_at = deleted_at_value,
      deleted_reason = reason_value,
      restored_at = null,
      updated_at = now()
    where id = staff_row.id;
  end if;

  update public.hid_user_profiles
  set
    active = false,
    deleted_at = deleted_at_value,
    deleted_reason = reason_value,
    deleted_by_user_profile_id = p_actor_profile_id,
    restored_at = null,
    restored_by_user_profile_id = null,
    updated_at = now()
  where id = profile_row.id;

  return jsonb_build_object(
    'deleted', true,
    'deleted_at', deleted_at_value
  );
end;
$$;

create or replace function public.hid_restore_account_by_auth_user_id(
  p_auth_user_id uuid,
  p_actor_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.hid_user_profiles;
  patient_row public.hid_patients;
  staff_row public.hid_staff_accounts;
  restored_at_value timestamptz := now();
begin
  select *
  into profile_row
  from public.hid_user_profiles
  where auth_user_id = p_auth_user_id
  limit 1;

  if profile_row.id is null then
    return jsonb_build_object('restored', false);
  end if;

  if profile_row.deleted_at is null then
    return jsonb_build_object('restored', false);
  end if;

  select *
  into patient_row
  from public.hid_patients
  where auth_user_id = p_auth_user_id
  limit 1;

  select *
  into staff_row
  from public.hid_staff_accounts
  where auth_user_id = p_auth_user_id
  limit 1;

  if patient_row.id is not null then
    update public.hid_patients
    set
      deleted_at = null,
      deleted_reason = null,
      restored_at = restored_at_value,
      updated_at = now()
    where id = patient_row.id;
  end if;

  if staff_row.id is not null then
    update public.hid_staff_accounts
    set
      active = true,
      deleted_at = null,
      deleted_reason = null,
      restored_at = restored_at_value,
      updated_at = now()
    where id = staff_row.id;
  end if;

  update public.hid_user_profiles
  set
    active = true,
    deleted_at = null,
    deleted_reason = null,
    deleted_by_user_profile_id = null,
    restored_at = restored_at_value,
    restored_by_user_profile_id = p_actor_profile_id,
    updated_at = now()
  where id = profile_row.id;

  return jsonb_build_object(
    'restored', true,
    'restored_at', restored_at_value
  );
end;
$$;

create or replace function public.hid_admin_auth_user_search(
  p_query text,
  p_limit integer default 20
)
returns table (
  auth_user_id uuid,
  email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  select
    users.id as auth_user_id,
    users.email::text as email,
    users.email_confirmed_at,
    users.last_sign_in_at
  from auth.users users
  where lower(coalesce(users.email, '')) like lower('%' || trim(coalesce(p_query, '')) || '%')
  order by coalesce(users.last_sign_in_at, users.created_at) desc nulls last, users.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

revoke all on function public.hid_soft_delete_account_by_auth_user_id(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.hid_soft_delete_account_by_auth_user_id(uuid, text, uuid) to service_role;

revoke all on function public.hid_restore_account_by_auth_user_id(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hid_restore_account_by_auth_user_id(uuid, uuid) to service_role;

revoke all on function public.hid_admin_auth_user_search(text, integer) from public, anon, authenticated;
grant execute on function public.hid_admin_auth_user_search(text, integer) to service_role;
