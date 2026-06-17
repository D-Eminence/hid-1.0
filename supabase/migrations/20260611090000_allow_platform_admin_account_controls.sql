begin;

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

revoke all on function public.hid_soft_delete_account_by_auth_user_id(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.hid_soft_delete_account_by_auth_user_id(uuid, text, uuid) to service_role;

commit;
