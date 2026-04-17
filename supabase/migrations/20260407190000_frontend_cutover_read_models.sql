begin;

create or replace function public.hid_get_patient_records(p_patient_identifier text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_patient_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_patient_identifier is null or trim(p_patient_identifier) = '' then
    target_patient_id := public.hid_current_patient_id();
  else
    target_patient_id := public.hid_resolve_patient_identifier(p_patient_identifier);
  end if;

  if target_patient_id is null then
    raise exception 'Patient was not found';
  end if;

  if public.hid_current_patient_id() <> target_patient_id and not public.hid_has_active_grant(target_patient_id, 'read_records') and not public.hid_is_platform_admin() then
    raise exception 'You do not have permission to read this patient record';
  end if;

  return jsonb_build_object(
    'patient', (
      select to_jsonb(patient_row)
      from public.hid_patients patient_row
      where patient_row.id = target_patient_id
    ),
    'records', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'record',
            to_jsonb(record_row)
              || jsonb_build_object(
                'created_by_name', coalesce(version_staff.full_name, version_profile.display_name, patient_creator.full_name, 'Authorized user'),
                'created_by_role', coalesce(version_staff.role::text, case when patient_creator.id is not null then 'patient' else version_profile.app_role::text end, 'patient')
              ),
            'current_version',
            coalesce(to_jsonb(version_row), '{}'::jsonb)
              || jsonb_build_object(
                'created_by_name', coalesce(version_staff.full_name, version_profile.display_name, patient_creator.full_name, 'Authorized user'),
                'created_by_role', coalesce(version_staff.role::text, case when patient_creator.id is not null then 'patient' else version_profile.app_role::text end, 'patient')
              ),
            'files', (
              select coalesce(jsonb_agg(to_jsonb(file_row) order by file_row.created_at), '[]'::jsonb)
              from public.hid_medical_record_files file_row
              where file_row.record_id = record_row.id
            )
          )
          order by record_row.created_at desc
        ),
        '[]'::jsonb
      )
      from public.hid_medical_records record_row
      left join public.hid_medical_record_versions version_row on version_row.id = record_row.current_version_id
      left join public.hid_user_profiles version_profile on version_profile.id = version_row.created_by_user_profile_id
      left join public.hid_staff_accounts version_staff on version_staff.id = version_row.created_by_staff_account_id
      left join public.hid_patients patient_creator on patient_creator.user_profile_id = version_row.created_by_user_profile_id
      where record_row.patient_id = target_patient_id
    )
  );
end;
$$;

create or replace function public.hid_list_my_access_history(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_id uuid := public.hid_current_patient_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if patient_id is null then
    raise exception 'Patient profile not found';
  end if;

  return jsonb_build_object(
    'pending_requests', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'request_id', request_row.id,
            'staff_account_id', staff_row.id,
            'staff_name', staff_row.full_name,
            'staff_role', staff_row.role,
            'hospital_name', staff_row.hospital_name,
            'scope', request_row.scope,
            'status', request_row.status,
            'reason', request_row.reason,
            'break_glass', request_row.break_glass,
            'created_at', request_row.created_at,
            'approved_at', request_row.approved_at
          )
          order by request_row.created_at desc
        ),
        '[]'::jsonb
      )
      from public.hid_access_requests request_row
      join public.hid_staff_accounts staff_row on staff_row.id = request_row.requester_staff_account_id
      where request_row.patient_id = patient_id
        and request_row.status = 'pending'
    ),
    'active_grants', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'grant_id', grant_row.id,
            'request_id', grant_row.request_id,
            'staff_account_id', staff_row.id,
            'staff_name', staff_row.full_name,
            'staff_role', staff_row.role,
            'hospital_name', staff_row.hospital_name,
            'scope', grant_row.scope,
            'status', grant_row.status,
            'reason', grant_row.reason,
            'starts_at', grant_row.starts_at,
            'expires_at', grant_row.expires_at,
            'break_glass', coalesce(request_row.break_glass, false)
          )
          order by grant_row.starts_at desc
        ),
        '[]'::jsonb
      )
      from public.hid_access_grants grant_row
      join public.hid_staff_accounts staff_row on staff_row.id = grant_row.staff_account_id
      left join public.hid_access_requests request_row on request_row.id = grant_row.request_id
      where grant_row.patient_id = patient_id
        and grant_row.status = 'active'
        and grant_row.expires_at > now()
    ),
    'events', (
      select coalesce(jsonb_agg(event_payload order by created_at desc), '[]'::jsonb)
      from (
        select
          jsonb_build_object(
            'event_id', audit_row.event_id,
            'action', audit_row.action,
            'resource_type', audit_row.resource_type,
            'reason', coalesce(audit_row.reason, audit_row.metadata ->> 'reason'),
            'created_at', audit_row.created_at,
            'actor_name', coalesce(staff_row.full_name, profile_row.display_name, 'System'),
            'actor_role', coalesce(staff_row.role::text, profile_row.app_role::text, 'system'),
            'hospital_name', staff_row.hospital_name,
            'metadata', audit_row.metadata
          ) as event_payload,
          audit_row.created_at
        from public.hid_audit_events audit_row
        left join public.hid_user_profiles profile_row on profile_row.id = audit_row.actor_profile_id
        left join public.hid_staff_accounts staff_row on staff_row.user_profile_id = audit_row.actor_profile_id
        where audit_row.patient_id = patient_id
        order by audit_row.created_at desc
        limit greatest(1, least(coalesce(p_limit, 50), 200))
      ) event_rows
    )
  );
end;
$$;

create or replace function public.hid_get_my_staff_dashboard(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_id uuid := public.hid_current_staff_account_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if staff_id is null then
    raise exception 'Staff profile not found';
  end if;

  return jsonb_build_object(
    'staff_account', (
      select to_jsonb(staff_row)
      from public.hid_staff_accounts staff_row
      where staff_row.id = staff_id
    ),
    'memberships', (
      select coalesce(
        jsonb_agg(to_jsonb(membership_row) order by membership_row.is_primary desc, membership_row.created_at desc),
        '[]'::jsonb
      )
      from public.hid_staff_memberships membership_row
      where membership_row.staff_account_id = staff_id
        and membership_row.active = true
    ),
    'requests', (
      select coalesce(jsonb_agg(request_payload order by created_at desc), '[]'::jsonb)
      from (
        select
          jsonb_build_object(
            'request_id', request_row.id,
            'grant_id', grant_row.id,
            'patient_id', patient_row.id,
            'hid_code', patient_row.hid_code,
            'patient_name', patient_row.full_name,
            'scope', request_row.scope,
            'request_status', request_row.status,
            'grant_status', grant_row.status,
            'reason', coalesce(grant_row.revoked_reason, request_row.reason),
            'break_glass', request_row.break_glass,
            'created_at', request_row.created_at,
            'approved_at', request_row.approved_at,
            'expires_at', grant_row.expires_at,
            'hospital_name', staff_row.hospital_name
          ) as request_payload,
          request_row.created_at
        from public.hid_access_requests request_row
        join public.hid_patients patient_row on patient_row.id = request_row.patient_id
        join public.hid_staff_accounts staff_row on staff_row.id = request_row.requester_staff_account_id
        left join lateral (
          select *
          from public.hid_access_grants latest_grant
          where latest_grant.request_id = request_row.id
          order by latest_grant.created_at desc
          limit 1
        ) grant_row on true
        where request_row.requester_staff_account_id = staff_id
        order by request_row.created_at desc
        limit greatest(1, least(coalesce(p_limit, 50), 200))
      ) request_rows
    ),
    'audit_events', (
      select coalesce(jsonb_agg(event_payload order by created_at desc), '[]'::jsonb)
      from (
        select
          jsonb_build_object(
            'event_id', audit_row.event_id,
            'action', audit_row.action,
            'reason', audit_row.reason,
            'resource_type', audit_row.resource_type,
            'created_at', audit_row.created_at,
            'patient_hid_code', patient_row.hid_code,
            'patient_name', patient_row.full_name
          ) as event_payload,
          audit_row.created_at
        from public.hid_audit_events audit_row
        left join public.hid_patients patient_row on patient_row.id = audit_row.patient_id
        where audit_row.actor_user_id = auth.uid()
        order by audit_row.created_at desc
        limit greatest(1, least(coalesce(p_limit, 50), 200))
      ) event_rows
    )
  );
end;
$$;

create or replace function public.hid_deny_access_request(
  p_request_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.hid_access_requests;
  requester_profile_id uuid;
  denied_reason_value text := coalesce(nullif(trim(p_reason), ''), 'Request denied by patient');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into request_row
  from public.hid_access_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Access request was not found';
  end if;

  if request_row.patient_id <> public.hid_current_patient_id() then
    raise exception 'Only the patient can deny this request';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'Only pending requests can be denied';
  end if;

  update public.hid_access_requests
  set
    status = 'denied',
    denied_at = now(),
    denied_reason = denied_reason_value,
    updated_at = now()
  where id = request_row.id;

  select user_profile_id
  into requester_profile_id
  from public.hid_staff_accounts
  where id = request_row.requester_staff_account_id;

  perform public.hid_create_notification(
    requester_profile_id,
    request_row.patient_id,
    'Access denied',
    'A patient denied your access request.',
    'access_rejected'
  );

  perform public.hid_log_audit_event(
    'access_request',
    'access_denied',
    request_row.id,
    request_row.patient_id,
    null,
    denied_reason_value,
    '{}'::jsonb
  );

  return jsonb_build_object('request_id', request_row.id, 'status', 'denied');
end;
$$;

create or replace function public.hid_close_my_access_grant(
  p_grant_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_row public.hid_access_grants;
  patient_profile_id uuid;
  close_reason text := coalesce(nullif(trim(p_reason), ''), 'Access session closed by clinician');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into grant_row
  from public.hid_access_grants
  where id = p_grant_id
  for update;

  if grant_row.id is null then
    raise exception 'Access grant was not found';
  end if;

  if grant_row.staff_account_id <> public.hid_current_staff_account_id() and not public.hid_is_platform_admin() then
    raise exception 'Only the assigned clinician can close this access grant';
  end if;

  if grant_row.status <> 'active' then
    raise exception 'Only active access grants can be closed';
  end if;

  update public.hid_access_grants
  set
    status = 'expired',
    expires_at = least(expires_at, now()),
    revoked_at = now(),
    revoked_by_user_profile_id = public.hid_current_user_profile_id(),
    revoked_reason = close_reason,
    updated_at = now()
  where id = grant_row.id;

  if grant_row.request_id is not null then
    update public.hid_access_requests
    set
      status = 'expired',
      updated_at = now()
    where id = grant_row.request_id
      and status = 'approved';
  end if;

  select user_profile_id
  into patient_profile_id
  from public.hid_patients
  where id = grant_row.patient_id;

  perform public.hid_create_notification(
    patient_profile_id,
    grant_row.patient_id,
    'Access session closed',
    'A clinician closed their access session to your record.',
    'system'
  );

  perform public.hid_log_audit_event(
    'access_grant',
    'access_session_closed',
    grant_row.id,
    grant_row.patient_id,
    null,
    close_reason,
    jsonb_build_object('request_id', grant_row.request_id)
  );

  return jsonb_build_object('grant_id', grant_row.id, 'status', 'expired');
end;
$$;

revoke all on function public.hid_list_my_access_history(integer) from anon, public;
grant execute on function public.hid_list_my_access_history(integer) to authenticated;

revoke all on function public.hid_get_my_staff_dashboard(integer) from anon, public;
grant execute on function public.hid_get_my_staff_dashboard(integer) to authenticated;

revoke all on function public.hid_deny_access_request(uuid, text) from anon, public;
grant execute on function public.hid_deny_access_request(uuid, text) to authenticated;

revoke all on function public.hid_close_my_access_grant(uuid, text) from anon, public;
grant execute on function public.hid_close_my_access_grant(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
