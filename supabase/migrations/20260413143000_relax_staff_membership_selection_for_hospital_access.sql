begin;

with ranked_memberships as (
  select
    membership_row.id,
    membership_row.staff_account_id,
    row_number() over (
      partition by membership_row.staff_account_id
      order by membership_row.is_primary desc, membership_row.updated_at desc nulls last, membership_row.created_at desc, membership_row.id
    ) as row_no,
    max(case when membership_row.is_primary and membership_row.active then 1 else 0 end) over (
      partition by membership_row.staff_account_id
    ) as has_primary_active
  from public.hid_staff_memberships membership_row
  where membership_row.active = true
)
update public.hid_staff_memberships membership_row
set
  is_primary = true,
  updated_at = now()
from ranked_memberships
where membership_row.id = ranked_memberships.id
  and ranked_memberships.row_no = 1
  and ranked_memberships.has_primary_active = 0;

create or replace function public.hid_create_access_request(
  p_patient_identifier text,
  p_scope public.hid_access_scope,
  p_reason text,
  p_duration_minutes integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_id uuid := public.hid_resolve_patient_identifier(p_patient_identifier);
  staff_id uuid := public.hid_current_staff_account_id();
  membership_row public.hid_staff_memberships;
  request_id uuid;
  patient_profile_id uuid;
begin
  if patient_id is null then
    raise exception 'Patient was not found';
  end if;

  if staff_id is null then
    raise exception 'Only staff can request access';
  end if;

  select *
  into membership_row
  from public.hid_staff_memberships
  where staff_account_id = staff_id
    and active = true
  order by is_primary desc, updated_at desc nulls last, created_at desc
  limit 1;

  if membership_row.id is null then
    raise exception 'No active staff membership found';
  end if;

  insert into public.hid_access_requests (
    patient_id,
    requester_staff_account_id,
    requester_membership_id,
    scope,
    reason,
    requested_duration_minutes
  )
  values (
    patient_id,
    staff_id,
    membership_row.id,
    p_scope,
    trim(p_reason),
    greatest(5, least(coalesce(p_duration_minutes, 60), 1440))
  )
  returning id into request_id;

  select user_profile_id
  into patient_profile_id
  from public.hid_patients
  where id = patient_id;

  perform public.hid_create_notification(
    patient_profile_id,
    patient_id,
    'Access request received',
    'A clinician requested access to your records.',
    'access_request'
  );

  perform public.hid_log_audit_event(
    'access_request',
    'access_requested',
    request_id,
    patient_id,
    membership_row.organization_id,
    trim(p_reason),
    jsonb_build_object('scope', p_scope, 'duration_minutes', p_duration_minutes)
  );

  return jsonb_build_object('request_id', request_id, 'patient_id', patient_id);
end;
$$;

create or replace function public.hid_break_glass_access(
  p_patient_identifier text,
  p_reason text,
  p_duration_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_id uuid := public.hid_resolve_patient_identifier(p_patient_identifier);
  staff_id uuid := public.hid_current_staff_account_id();
  membership_row public.hid_staff_memberships;
  request_id uuid;
  grant_id uuid;
  patient_profile_id uuid;
  duration_value integer := greatest(5, least(coalesce(p_duration_minutes, 30), 240));
begin
  if patient_id is null then
    raise exception 'Patient was not found';
  end if;

  if staff_id is null then
    raise exception 'Only staff can use break-glass access';
  end if;

  select *
  into membership_row
  from public.hid_staff_memberships
  where staff_account_id = staff_id
    and active = true
  order by is_primary desc, updated_at desc nulls last, created_at desc
  limit 1;

  if membership_row.id is null then
    raise exception 'No active staff membership found';
  end if;

  insert into public.hid_access_requests (
    patient_id,
    requester_staff_account_id,
    requester_membership_id,
    scope,
    reason,
    status,
    requested_duration_minutes,
    break_glass,
    approved_at
  )
  values (
    patient_id,
    staff_id,
    membership_row.id,
    'break_glass',
    trim(p_reason),
    'approved',
    duration_value,
    true,
    now()
  )
  returning id into request_id;

  insert into public.hid_access_grants (
    request_id,
    patient_id,
    staff_account_id,
    membership_id,
    scope,
    status,
    reason,
    starts_at,
    expires_at
  )
  values (
    request_id,
    patient_id,
    staff_id,
    membership_row.id,
    'break_glass',
    'active',
    trim(p_reason),
    now(),
    now() + make_interval(mins => duration_value)
  )
  returning id into grant_id;

  select user_profile_id
  into patient_profile_id
  from public.hid_patients
  where id = patient_id;

  perform public.hid_create_notification(
    patient_profile_id,
    patient_id,
    'Emergency access used',
    'A clinician used emergency access to open your records.',
    'break_glass'
  );

  perform public.hid_log_audit_event(
    'access_grant',
    'break_glass_access',
    grant_id,
    patient_id,
    membership_row.organization_id,
    trim(p_reason),
    jsonb_build_object('request_id', request_id, 'duration_minutes', duration_value)
  );

  return jsonb_build_object('request_id', request_id, 'grant_id', grant_id);
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
    and membership_row.active = true
  order by membership_row.is_primary desc, membership_row.updated_at desc nulls last, membership_row.created_at desc
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
