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

  if v_role = 'platform_admin' and not p_allow_platform_admin then
    raise exception 'Platform admin accounts require the primary administrator deletion flow.';
  end if;

  select id into v_patient_id
  from public.hid_patients
  where auth_user_id = p_auth_user_id
  limit 1;

  select id into v_staff_id
  from public.hid_staff_accounts
  where auth_user_id = p_auth_user_id
  limit 1;

  if v_staff_id is not null then
    select coalesce(array_agg(distinct organization_id), '{}')
    into v_org_ids
    from public.hid_staff_memberships
    where staff_account_id = v_staff_id;
  end if;

  -- AI configuration belongs to the platform, not an individual administrator.
  update public.hid_ai_providers
  set created_by_user_profile_id = null, updated_by_user_profile_id = null
  where created_by_user_profile_id = v_profile_id or updated_by_user_profile_id = v_profile_id;

  update public.hid_ai_models
  set created_by_user_profile_id = null, updated_by_user_profile_id = null
  where created_by_user_profile_id = v_profile_id or updated_by_user_profile_id = v_profile_id;

  update public.hid_ai_workload_routes
  set updated_by_user_profile_id = null
  where updated_by_user_profile_id = v_profile_id;

  update public.hid_ai_budgets
  set updated_by_user_profile_id = null
  where updated_by_user_profile_id = v_profile_id;

  -- Personal-account audit history is removed. Platform-admin audit history is
  -- retained and automatically anonymized by the foreign-key delete action.
  if v_role <> 'platform_admin' then
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
  end if;

  delete from public.hid_health_events
  where created_by_user_profile_id = v_profile_id
     or (v_patient_id is not null and patient_id = v_patient_id);

  delete from public.hid_share_invites
  where v_patient_id is not null and patient_id = v_patient_id;

  delete from public.hid_access_grants
  where (v_patient_id is not null and patient_id = v_patient_id)
     or (v_staff_id is not null and staff_account_id = v_staff_id);

  delete from public.hid_access_requests
  where (v_patient_id is not null and patient_id = v_patient_id)
     or (v_staff_id is not null and requester_staff_account_id = v_staff_id);

  delete from public.hid_medical_records
  where (v_patient_id is not null and patient_id = v_patient_id)
     or created_by_user_profile_id = v_profile_id
     or exists (
       select 1
       from public.hid_medical_record_versions as version_row
       where version_row.record_id = hid_medical_records.id
         and version_row.created_by_user_profile_id = v_profile_id
     );

  delete from public.hid_medical_record_files
  where uploaded_by_user_profile_id = v_profile_id
     or (v_patient_id is not null and patient_id = v_patient_id);

  delete from public.hid_patient_identifiers
  where v_patient_id is not null and patient_id = v_patient_id;

  delete from public.hid_auth_challenges
  where auth_user_id = p_auth_user_id
     or (v_patient_id is not null and patient_id = v_patient_id);

  delete from public.hid_staff_invites
  where invited_by_user_profile_id = v_profile_id;

  if v_staff_id is not null then
    delete from public.hid_staff_accounts where id = v_staff_id;
  end if;

  if v_patient_id is not null then
    delete from public.hid_patients where id = v_patient_id;
  end if;

  delete from public.hid_notifications where user_profile_id = v_profile_id;
  delete from public.hid_user_profiles where id = v_profile_id;
  delete from auth.users where id = p_auth_user_id;

  if cardinality(v_org_ids) > 0 then
    foreach v_org_id in array v_org_ids loop
      if not exists (
        select 1 from public.hid_staff_memberships where organization_id = v_org_id limit 1
      ) then
        delete from public.hid_organizations where id = v_org_id;
      end if;
    end loop;
  end if;

  return jsonb_build_object('deleted', true);
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

revoke all on function public.hid_permanently_delete_account_by_auth_user_id(uuid, boolean) from public, anon, authenticated;
grant execute on function public.hid_permanently_delete_account_by_auth_user_id(uuid, boolean) to service_role;

commit;
