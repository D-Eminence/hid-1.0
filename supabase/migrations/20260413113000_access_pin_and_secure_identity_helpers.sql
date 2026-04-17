begin;

create or replace function public.hid_current_user_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.hid_user_profiles
  where auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.hid_current_patient_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.hid_patients
  where auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.hid_current_staff_account_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.hid_staff_accounts
  where auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.hid_current_app_role()
returns public.hid_app_role
language sql
stable
security definer
set search_path = public
as $$
  select app_role
  from public.hid_user_profiles
  where auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.hid_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.hid_current_app_role() = 'platform_admin', false)
$$;

create or replace function public.hid_is_org_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.hid_is_platform_admin()
    or exists (
      select 1
      from public.hid_staff_memberships membership
      join public.hid_staff_accounts staff on staff.id = membership.staff_account_id
      where staff.auth_user_id = auth.uid()
        and membership.organization_id = target_organization_id
        and membership.active = true
        and membership.app_role = 'org_admin'
    )
$$;

create or replace function public.hid_has_active_grant(
  target_patient_id uuid,
  required_scope public.hid_access_scope default 'read_records'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hid_access_grants grant_row
    join public.hid_staff_accounts staff on staff.id = grant_row.staff_account_id
    where staff.auth_user_id = auth.uid()
      and grant_row.patient_id = target_patient_id
      and grant_row.status = 'active'
      and grant_row.starts_at <= now()
      and grant_row.expires_at > now()
      and (
        grant_row.scope = required_scope
        or grant_row.scope = 'break_glass'
        or (required_scope = 'read_records' and grant_row.scope = 'write_records')
      )
  )
$$;

grant execute on function public.hid_current_user_profile_id() to authenticated;
grant execute on function public.hid_current_patient_id() to authenticated;
grant execute on function public.hid_current_staff_account_id() to authenticated;
grant execute on function public.hid_current_app_role() to authenticated;
grant execute on function public.hid_is_platform_admin() to authenticated;
grant execute on function public.hid_is_org_admin(uuid) to authenticated;
grant execute on function public.hid_has_active_grant(uuid, public.hid_access_scope) to authenticated;

create table if not exists public.hid_patient_access_secrets (
  patient_id uuid primary key references public.hid_patients(id) on delete cascade,
  access_pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hid_patient_access_secrets enable row level security;

create or replace function public.hid_has_patient_access_pin(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hid_patient_access_secrets secret_row
    where secret_row.patient_id = p_patient_id
  )
$$;

grant execute on function public.hid_has_patient_access_pin(uuid) to authenticated;

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

grant execute on function public.hid_set_my_access_pin(text) to authenticated;

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

grant execute on function public.hid_access_patient_with_pin(text, text, integer) to authenticated;

create or replace function public.hid_get_my_patient_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_row public.hid_patients;
begin
  select *
  into patient_row
  from public.hid_patients
  where auth_user_id = auth.uid();

  if patient_row.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'patient',
    to_jsonb(patient_row)
      || jsonb_build_object('access_pin_configured', public.hid_has_patient_access_pin(patient_row.id)),
    'identifiers', (
      select coalesce(jsonb_agg(to_jsonb(identifier_row) order by identifier_row.created_at), '[]'::jsonb)
      from public.hid_patient_identifiers identifier_row
      where identifier_row.patient_id = patient_row.id
    ),
    'active_grants', (
      select coalesce(count(*), 0)
      from public.hid_access_grants grant_row
      where grant_row.patient_id = patient_row.id
        and grant_row.status = 'active'
        and grant_row.expires_at > now()
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
  v_patient_id uuid := public.hid_current_patient_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if v_patient_id is null then
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
      where request_row.patient_id = v_patient_id
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
      where grant_row.patient_id = v_patient_id
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
        where audit_row.patient_id = v_patient_id
        order by audit_row.created_at desc
        limit greatest(1, least(coalesce(p_limit, 50), 200))
      ) event_rows
    )
  );
end;
$$;

commit;
