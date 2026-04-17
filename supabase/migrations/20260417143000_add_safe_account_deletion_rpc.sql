begin;

create or replace function public.hid_delete_account_by_auth_user_id(p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_profile_id uuid;
  v_role public.hid_app_role;
  v_patient_id uuid;
  v_staff_id uuid;
  v_org_ids uuid[] := '{}';
  v_org_id uuid;
begin
  select id, app_role
  into v_profile_id, v_role
  from public.hid_user_profiles
  where auth_user_id = p_auth_user_id
  limit 1;

  if v_profile_id is null then
    return jsonb_build_object('deleted', false);
  end if;

  if v_role = 'platform_admin' then
    raise exception 'Platform admin accounts cannot be deleted here.';
  end if;

  select id
  into v_patient_id
  from public.hid_patients
  where auth_user_id = p_auth_user_id
  limit 1;

  select id
  into v_staff_id
  from public.hid_staff_accounts
  where auth_user_id = p_auth_user_id
  limit 1;

  if v_staff_id is not null then
    select coalesce(array_agg(distinct organization_id), '{}')
    into v_org_ids
    from public.hid_staff_memberships
    where staff_account_id = v_staff_id;
  end if;

  begin
    alter table public.hid_audit_events disable trigger hid_no_update_audit_events;

    delete from public.hid_audit_events
    where actor_user_id = p_auth_user_id
       or actor_profile_id = v_profile_id
       or (v_patient_id is not null and patient_id = v_patient_id)
       or (cardinality(v_org_ids) > 0 and organization_id = any(v_org_ids));

    alter table public.hid_audit_events enable trigger hid_no_update_audit_events;
  exception
    when others then
      alter table public.hid_audit_events enable trigger hid_no_update_audit_events;
      raise;
  end;

  if v_patient_id is not null then
    delete from public.hid_patients
    where id = v_patient_id;
  end if;

  delete from public.hid_medical_records
  where created_by_user_profile_id = v_profile_id;

  delete from public.hid_staff_invites
  where invited_by_user_profile_id = v_profile_id;

  if v_staff_id is not null then
    delete from public.hid_staff_accounts
    where id = v_staff_id;
  end if;

  delete from public.hid_notifications
  where user_profile_id = v_profile_id;

  delete from public.hid_user_profiles
  where id = v_profile_id;

  delete from auth.users
  where id = p_auth_user_id;

  if cardinality(v_org_ids) > 0 then
    foreach v_org_id in array v_org_ids loop
      if not exists (
        select 1
        from public.hid_staff_memberships
        where organization_id = v_org_id
        limit 1
      ) then
        delete from public.hid_organizations
        where id = v_org_id;
      end if;
    end loop;
  end if;

  return jsonb_build_object('deleted', true);
end;
$$;

create or replace function public.hid_delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  return public.hid_delete_account_by_auth_user_id(auth.uid());
end;
$$;

revoke all on function public.hid_delete_account_by_auth_user_id(uuid) from public, anon, authenticated;
grant execute on function public.hid_delete_account_by_auth_user_id(uuid) to service_role;

revoke all on function public.hid_delete_my_account() from public, anon;
grant execute on function public.hid_delete_my_account() to authenticated, service_role;

commit;
