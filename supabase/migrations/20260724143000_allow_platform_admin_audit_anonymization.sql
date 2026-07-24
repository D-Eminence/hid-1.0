begin;

create or replace function public.hid_permanently_delete_account_by_auth_user_id(
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
  v_role public.hid_app_role;
  v_result jsonb;
begin
  select deleted_at, app_role
  into v_deleted_at, v_role
  from public.hid_user_profiles
  where auth_user_id = p_auth_user_id
  limit 1;

  if not found then
    return jsonb_build_object('deleted', false);
  end if;

  if v_deleted_at is null then
    raise exception 'Delete the account first before permanently removing it.';
  end if;

  if v_role = 'platform_admin' then
    if not p_allow_platform_admin then
      raise exception 'Platform admin accounts require the primary administrator deletion flow.';
    end if;

    -- Platform-admin audit history must be retained. Temporarily allow the
    -- profile/auth foreign keys to anonymize that retained history while this
    -- transaction removes the deleted account, then restore append-only
    -- protection before returning.
    begin
      alter table public.hid_audit_events disable trigger hid_no_update_audit_events;

      v_result := public.hid_permanently_delete_soft_deleted_account_impl(
        p_auth_user_id,
        true
      );

      alter table public.hid_audit_events enable trigger hid_no_update_audit_events;
      return v_result;
    exception
      when others then
        alter table public.hid_audit_events enable trigger hid_no_update_audit_events;
        raise;
    end;
  end if;

  return public.hid_permanently_delete_soft_deleted_account_impl(
    p_auth_user_id,
    false
  );
end;
$$;

revoke all on function public.hid_permanently_delete_account_by_auth_user_id(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.hid_permanently_delete_account_by_auth_user_id(uuid, boolean)
  to service_role;

commit;
