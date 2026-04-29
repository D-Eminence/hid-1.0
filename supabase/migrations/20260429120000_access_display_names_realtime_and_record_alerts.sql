begin;

alter table public.hid_access_requests
  add column if not exists staff_display_name text;

alter table public.hid_access_grants
  add column if not exists staff_display_name text;

do $$
declare
  realtime_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach realtime_table in array array[
      'hid_access_requests',
      'hid_access_grants',
      'hid_audit_events',
      'hid_notifications',
      'hid_medical_records',
      'hid_medical_record_versions',
      'hid_medical_record_files'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = realtime_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', realtime_table);
      end if;
    end loop;
  end if;
end $$;

alter table public.hid_access_requests replica identity full;
alter table public.hid_access_grants replica identity full;
alter table public.hid_audit_events replica identity full;
alter table public.hid_notifications replica identity full;
alter table public.hid_medical_records replica identity full;
alter table public.hid_medical_record_versions replica identity full;
alter table public.hid_medical_record_files replica identity full;

drop function if exists public.hid_create_access_request(text, public.hid_access_scope, text, integer);
create or replace function public.hid_create_access_request(
  p_patient_identifier text,
  p_scope public.hid_access_scope,
  p_reason text,
  p_duration_minutes integer default 60,
  p_staff_display_name text default null
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
  staff_display_name_value text := nullif(left(trim(regexp_replace(coalesce(p_staff_display_name, ''), '\s+', ' ', 'g')), 120), '');
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
    requested_duration_minutes,
    staff_display_name
  )
  values (
    patient_id,
    staff_id,
    membership_row.id,
    p_scope,
    trim(p_reason),
    greatest(5, least(coalesce(p_duration_minutes, 60), 1440)),
    staff_display_name_value
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
    coalesce(staff_display_name_value, 'A clinician') || ' requested access to your records.',
    'access_request'
  );

  perform public.hid_log_audit_event(
    'access_request',
    'access_requested',
    request_id,
    patient_id,
    membership_row.organization_id,
    trim(p_reason),
    jsonb_build_object(
      'scope', p_scope,
      'duration_minutes', p_duration_minutes,
      'staff_display_name', staff_display_name_value
    )
  );

  return jsonb_build_object('request_id', request_id, 'patient_id', patient_id);
end;
$$;

drop function if exists public.hid_break_glass_access(text, text, integer);
create or replace function public.hid_break_glass_access(
  p_patient_identifier text,
  p_reason text,
  p_duration_minutes integer default 30,
  p_staff_display_name text default null
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
  staff_display_name_value text := nullif(left(trim(regexp_replace(coalesce(p_staff_display_name, ''), '\s+', ' ', 'g')), 120), '');
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
    approved_at,
    staff_display_name
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
    now(),
    staff_display_name_value
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
    expires_at,
    staff_display_name
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
    now() + make_interval(mins => duration_value),
    staff_display_name_value
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
    coalesce(staff_display_name_value, 'A clinician') || ' used emergency access to open your records.',
    'break_glass'
  );

  perform public.hid_log_audit_event(
    'access_grant',
    'break_glass_access',
    grant_id,
    patient_id,
    membership_row.organization_id,
    trim(p_reason),
    jsonb_build_object(
      'request_id', request_id,
      'duration_minutes', duration_value,
      'staff_display_name', staff_display_name_value
    )
  );

  return jsonb_build_object('request_id', request_id, 'grant_id', grant_id);
end;
$$;

drop function if exists public.hid_access_patient_with_pin(text, text, integer);
create or replace function public.hid_access_patient_with_pin(
  p_patient_identifier text,
  p_access_pin text,
  p_duration_minutes integer default 60,
  p_staff_display_name text default null
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
  v_staff_display_name text := nullif(left(trim(regexp_replace(coalesce(p_staff_display_name, ''), '\s+', ' ', 'g')), 120), '');
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
    if v_staff_display_name is not null then
      update public.hid_access_grants
      set
        staff_display_name = v_staff_display_name,
        updated_at = now()
      where id = v_existing_grant_id;

      if v_existing_request_id is not null then
        update public.hid_access_requests
        set
          staff_display_name = v_staff_display_name,
          updated_at = now()
        where id = v_existing_request_id;
      end if;
    end if;

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
    approved_at,
    staff_display_name
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
    now(),
    v_staff_display_name
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
    expires_at,
    staff_display_name
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
    now() + make_interval(mins => v_duration_minutes),
    v_staff_display_name
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
    coalesce(v_staff_display_name, 'A hospital account') || ' used your Access PIN to open your HID records.',
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
      'duration_minutes', v_duration_minutes,
      'staff_display_name', v_staff_display_name
    )
  );

  return jsonb_build_object(
    'request_id', v_request_id,
    'grant_id', v_grant_id,
    'patient_id', v_patient_id
  );
end;
$$;

create or replace function public.hid_approve_access_request(
  p_request_id uuid,
  p_duration_minutes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.hid_access_requests;
  grant_id uuid;
  requester_profile_id uuid;
  duration_value integer;
begin
  select *
  into request_row
  from public.hid_access_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Access request was not found';
  end if;

  if request_row.patient_id <> public.hid_current_patient_id() then
    raise exception 'Only the patient can approve this request';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'Only pending requests can be approved';
  end if;

  duration_value := greatest(5, least(coalesce(p_duration_minutes, request_row.requested_duration_minutes), 1440));

  update public.hid_access_requests
  set
    status = 'approved',
    approved_by_patient_id = public.hid_current_patient_id(),
    approved_at = now(),
    updated_at = now()
  where id = request_row.id;

  insert into public.hid_access_grants (
    request_id,
    patient_id,
    staff_account_id,
    membership_id,
    scope,
    granted_by_patient_id,
    reason,
    starts_at,
    expires_at,
    staff_display_name
  )
  values (
    request_row.id,
    request_row.patient_id,
    request_row.requester_staff_account_id,
    request_row.requester_membership_id,
    request_row.scope,
    public.hid_current_patient_id(),
    request_row.reason,
    now(),
    now() + make_interval(mins => duration_value),
    request_row.staff_display_name
  )
  returning id into grant_id;

  select user_profile_id
  into requester_profile_id
  from public.hid_staff_accounts
  where id = request_row.requester_staff_account_id;

  perform public.hid_create_notification(
    requester_profile_id,
    request_row.patient_id,
    'Access approved',
    'Your access request has been approved.',
    'access_granted'
  );

  perform public.hid_log_audit_event(
    'access_grant',
    'access_approved',
    grant_id,
    request_row.patient_id,
    null,
    request_row.reason,
    jsonb_build_object(
      'request_id', request_row.id,
      'staff_display_name', request_row.staff_display_name
    )
  );

  return jsonb_build_object('grant_id', grant_id, 'request_id', request_row.id);
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
            'staff_name', coalesce(nullif(request_row.staff_display_name, ''), staff_row.full_name),
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
            'staff_name', coalesce(nullif(grant_row.staff_display_name, ''), nullif(request_row.staff_display_name, ''), staff_row.full_name),
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
            'actor_name', coalesce(audit_row.metadata ->> 'staff_display_name', staff_row.full_name, profile_row.display_name, 'System'),
            'actor_role', coalesce(staff_row.role::text, profile_row.app_role::text, 'system'),
            'hospital_name', coalesce(audit_row.metadata ->> 'hospital_name', staff_row.hospital_name),
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
            'hospital_name', staff_row.hospital_name,
            'staff_display_name', coalesce(nullif(grant_row.staff_display_name, ''), nullif(request_row.staff_display_name, ''), staff_row.full_name)
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

revoke all on function public.hid_create_access_request(text, public.hid_access_scope, text, integer, text) from anon, public;
grant execute on function public.hid_create_access_request(text, public.hid_access_scope, text, integer, text) to authenticated;

revoke all on function public.hid_break_glass_access(text, text, integer, text) from anon, public;
grant execute on function public.hid_break_glass_access(text, text, integer, text) to authenticated;

revoke all on function public.hid_access_patient_with_pin(text, text, integer, text) from anon, public;
grant execute on function public.hid_access_patient_with_pin(text, text, integer, text) to authenticated;

revoke all on function public.hid_approve_access_request(uuid, integer) from anon, public;
grant execute on function public.hid_approve_access_request(uuid, integer) to authenticated;

revoke all on function public.hid_list_my_access_history(integer) from anon, public;
grant execute on function public.hid_list_my_access_history(integer) to authenticated;

revoke all on function public.hid_get_my_staff_dashboard(integer) from anon, public;
grant execute on function public.hid_get_my_staff_dashboard(integer) to authenticated;

notify pgrst, 'reload schema';

commit;
