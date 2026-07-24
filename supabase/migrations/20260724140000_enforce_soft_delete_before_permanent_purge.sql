begin;

-- Keep the existing purge implementation private and put the account-state
-- guard in front of every permanent deletion call. This prevents any service
-- path from bypassing the required soft-delete stage.
alter function public.hid_permanently_delete_account_by_auth_user_id(uuid, boolean)
  rename to hid_permanently_delete_soft_deleted_account_impl;

create function public.hid_permanently_delete_account_by_auth_user_id(
  p_auth_user_id uuid,
  p_allow_platform_admin boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_deleted_at timestamptz;
begin
  select deleted_at
  into v_deleted_at
  from public.hid_user_profiles
  where auth_user_id = p_auth_user_id
  limit 1;

  if not found then
    return jsonb_build_object('deleted', false);
  end if;

  if v_deleted_at is null then
    raise exception 'Delete the account first before permanently removing it.';
  end if;

  return public.hid_permanently_delete_soft_deleted_account_impl(
    p_auth_user_id,
    p_allow_platform_admin
  );
end;
$$;

create or replace function public.hid_delete_account_by_auth_user_id(p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return public.hid_permanently_delete_account_by_auth_user_id(p_auth_user_id, false);
end;
$$;

revoke all on function public.hid_permanently_delete_soft_deleted_account_impl(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.hid_permanently_delete_account_by_auth_user_id(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.hid_permanently_delete_account_by_auth_user_id(uuid, boolean)
  to service_role;

commit;
