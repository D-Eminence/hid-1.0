begin;

create or replace function public.hid_set_my_access_pin(p_access_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid := public.hid_current_patient_id();
  v_profile_id uuid := public.hid_current_user_profile_id();
  v_access_pin text := regexp_replace(coalesce(p_access_pin, ''), '\s+', '', 'g');
begin
  if auth.uid() is null or v_patient_id is null then
    raise exception 'Authentication required';
  end if;

  if v_access_pin = '' then
    delete from public.hid_patient_access_secrets
    where patient_id = v_patient_id;

    perform public.hid_log_audit_event(
      'patient_profile',
      'patient_access_pin_removed',
      v_patient_id,
      v_patient_id,
      null,
      'Patient access PIN removed',
      '{}'::jsonb
    );

    return jsonb_build_object('configured', false);
  end if;

  if v_access_pin !~ '^[0-9]{4,8}$' then
    raise exception 'Access PIN must be 4 to 8 digits.';
  end if;

  insert into public.hid_patient_access_secrets (patient_id, access_pin_hash, updated_at)
  values (v_patient_id, extensions.crypt(v_access_pin, extensions.gen_salt('bf')), now())
  on conflict (patient_id)
  do update
    set access_pin_hash = excluded.access_pin_hash,
        updated_at = now();

  perform public.hid_log_audit_event(
    'patient_profile',
    'patient_access_pin_updated',
    v_patient_id,
    v_patient_id,
    null,
    'Patient access PIN updated',
    jsonb_build_object('actor_profile_id', v_profile_id)
  );

  return jsonb_build_object('configured', true);
end;
$$;

create or replace function public.hid_access_patient_with_pin(
  p_patient_identifier text,
  p_access_pin text,
  p_duration_minutes integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid := public.hid_resolve_patient_identifier(p_patient_identifier);
  v_staff_id uuid := public.hid_current_staff_account_id();
  v_membership_row public.hid_staff_memberships;
  v_secret_row public.hid_patient_access_secrets;
  v_request_id uuid;
  v_grant_id uuid;
  v_existing_request_id uuid;
  v_existing_grant_id uuid;
  v_patient_profile_id uuid;
  v_duration_minutes integer := greatest(5, least(coalesce(p_duration_minutes, 60), 1440));
  v_access_pin text := regexp_replace(coalesce(p_access_pin, ''), '\s+', '', 'g');
  v_reason text := 'Access PIN verified';
begin
  if v_patient_id is null or v_access_pin = '' or v_access_pin !~ '^[0-9]{4,8}$' then
    raise exception 'The HID code or access PIN is not correct.';
  end if;

  if v_staff_id is null then
    raise exception 'This account cannot perform this action right now.';
  end if;

  select *
  into v_membership_row
  from public.hid_staff_memberships membership_row
  where membership_row.staff_account_id = v_staff_id
    and membership_row.is_primary = true
    and membership_row.active = true
  limit 1;

  if v_membership_row.id is null then
    raise exception 'This account cannot perform this action right now.';
  end if;

  select *
  into v_secret_row
  from public.hid_patient_access_secrets secret_row
  where secret_row.patient_id = v_patient_id;

  if v_secret_row.patient_id is null or extensions.crypt(v_access_pin, v_secret_row.access_pin_hash) <> v_secret_row.access_pin_hash then
    raise exception 'The HID code or access PIN is not correct.';
  end if;

  select grant_row.id, grant_row.request_id
  into v_existing_grant_id, v_existing_request_id
  from public.hid_access_grants grant_row
  where grant_row.patient_id = v_patient_id
    and grant_row.staff_account_id = v_staff_id
    and grant_row.status = 'active'
    and grant_row.starts_at <= now()
    and grant_row.expires_at > now()
  order by grant_row.expires_at desc
  limit 1;

  if v_existing_grant_id is not null then
    return jsonb_build_object(
      'request_id', v_existing_request_id,
      'grant_id', v_existing_grant_id,
      'patient_id', v_patient_id
    );
  end if;

  insert into public.hid_access_requests (
    patient_id,
    requester_staff_account_id,
    requester_membership_id,
    scope,
    reason,
    status,
    requested_duration_minutes,
    approved_by_patient_id,
    approved_at
  )
  values (
    v_patient_id,
    v_staff_id,
    v_membership_row.id,
    'write_records',
    v_reason,
    'approved',
    v_duration_minutes,
    v_patient_id,
    now()
  )
  returning id into v_request_id;

  insert into public.hid_access_grants (
    request_id,
    patient_id,
    staff_account_id,
    membership_id,
    scope,
    granted_by_patient_id,
    reason,
    starts_at,
    expires_at
  )
  values (
    v_request_id,
    v_patient_id,
    v_staff_id,
    v_membership_row.id,
    'write_records',
    v_patient_id,
    v_reason,
    now(),
    now() + make_interval(mins => v_duration_minutes)
  )
  returning id into v_grant_id;

  select patient_row.user_profile_id
  into v_patient_profile_id
  from public.hid_patients patient_row
  where patient_row.id = v_patient_id;

  perform public.hid_create_notification(
    v_patient_profile_id,
    v_patient_id,
    'Hospital access started',
    'A hospital account used your Access PIN to open your HID records.',
    'access_granted'
  );

  perform public.hid_log_audit_event(
    'access_grant',
    'access_pin_verified',
    v_grant_id,
    v_patient_id,
    v_membership_row.organization_id,
    v_reason,
    jsonb_build_object(
      'grant_id', v_grant_id,
      'request_id', v_request_id,
      'scope', 'write_records',
      'duration_minutes', v_duration_minutes
    )
  );

  return jsonb_build_object(
    'request_id', v_request_id,
    'grant_id', v_grant_id,
    'patient_id', v_patient_id
  );
end;
$$;

commit;
