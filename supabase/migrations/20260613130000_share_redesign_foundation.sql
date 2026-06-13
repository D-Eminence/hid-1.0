begin;

do $$
begin
  create type public.hid_share_permission_tier as enum ('view_only', 'clinical_review', 'clinical_collaboration');
exception
  when duplicate_object then null;
end $$;

alter table public.hid_access_grants
  add column if not exists permission_tier public.hid_share_permission_tier,
  add column if not exists share_target_type text not null default 'profile' check (share_target_type in ('profile', 'record', 'health_event')),
  add column if not exists share_target_id uuid,
  add column if not exists duration_preset text check (duration_preset in ('24h', '7d', '30d', 'until_revoked'));

-- Patients search for a provider to share their profile with, by exact email
-- match or a name/hospital prefix match. Only active, verified staff accounts
-- are returned, and only patients may call this.
create or replace function public.hid_search_staff_for_share(p_query text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  trimmed_query text := trim(coalesce(p_query, ''));
  result jsonb;
begin
  if public.hid_current_patient_id() is null then
    raise exception 'Only patients can search for providers to share with';
  end if;

  if length(trimmed_query) < 2 then
    return '[]'::jsonb;
  end if;

  if trimmed_query like '%@%' then
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'staff_account_id', staff_row.id,
        'full_name', staff_row.full_name,
        'hospital_name', staff_row.hospital_name,
        'role', staff_row.role
      )),
      '[]'::jsonb
    )
    into result
    from public.hid_staff_accounts staff_row
    where staff_row.active = true
      and staff_row.verification_status = 'verified'
      and staff_row.email = trimmed_query::citext;
  else
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'staff_account_id', staff_row.id,
        'full_name', staff_row.full_name,
        'hospital_name', staff_row.hospital_name,
        'role', staff_row.role
      )),
      '[]'::jsonb
    )
    into result
    from (
      select *
      from public.hid_staff_accounts staff_row
      where staff_row.active = true
        and staff_row.verification_status = 'verified'
        and (staff_row.full_name ilike '%' || trimmed_query || '%' or staff_row.hospital_name ilike '%' || trimmed_query || '%')
      order by staff_row.full_name
      limit 10
    ) staff_row;
  end if;

  return result;
end;
$$;

-- Patient-initiated profile share: creates an active access grant directly
-- (no request/approval step), with a permission tier and duration preset.
create or replace function public.hid_create_share(
  p_staff_account_id uuid,
  p_permission_tier public.hid_share_permission_tier,
  p_duration_preset text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_id uuid := public.hid_current_patient_id();
  staff_row public.hid_staff_accounts;
  membership_row public.hid_staff_memberships;
  grant_scope public.hid_access_scope;
  grant_expires_at timestamptz;
  grant_id uuid;
  tier_label text;
begin
  if patient_id is null then
    raise exception 'Only patients can create shares';
  end if;

  if p_duration_preset not in ('24h', '7d', '30d', 'until_revoked') then
    raise exception 'Invalid duration preset';
  end if;

  select *
  into staff_row
  from public.hid_staff_accounts
  where id = p_staff_account_id
    and active = true
    and verification_status = 'verified';

  if staff_row.id is null then
    raise exception 'Provider was not found';
  end if;

  select *
  into membership_row
  from public.hid_staff_memberships
  where staff_account_id = staff_row.id
    and active = true
  order by is_primary desc, updated_at desc nulls last, created_at desc
  limit 1;

  if membership_row.id is null then
    raise exception 'This provider has no active membership';
  end if;

  grant_scope := case p_permission_tier
    when 'clinical_collaboration' then 'write_records'
    else 'read_records'
  end;

  grant_expires_at := case p_duration_preset
    when '24h' then now() + interval '24 hours'
    when '7d' then now() + interval '7 days'
    when '30d' then now() + interval '30 days'
    else now() + interval '100 years'
  end;

  tier_label := case p_permission_tier
    when 'clinical_collaboration' then 'Clinical Collaboration'
    when 'clinical_review' then 'Clinical Review'
    else 'View Only'
  end;

  insert into public.hid_access_grants (
    patient_id,
    staff_account_id,
    membership_id,
    scope,
    permission_tier,
    share_target_type,
    duration_preset,
    granted_by_patient_id,
    reason,
    starts_at,
    expires_at,
    staff_display_name
  )
  values (
    patient_id,
    staff_row.id,
    membership_row.id,
    grant_scope,
    p_permission_tier,
    'profile',
    p_duration_preset,
    patient_id,
    coalesce(nullif(trim(p_reason), ''), 'Shared by patient'),
    now(),
    grant_expires_at,
    staff_row.full_name
  )
  returning id into grant_id;

  perform public.hid_create_notification(
    staff_row.user_profile_id,
    patient_id,
    'Profile shared with you',
    'A patient shared their profile with you (' || tier_label || ' access).',
    'access_granted'
  );

  perform public.hid_log_audit_event(
    'patient_share',
    'share_created',
    grant_id,
    patient_id,
    membership_row.organization_id,
    p_reason,
    jsonb_build_object(
      'permission_tier', p_permission_tier,
      'duration_preset', p_duration_preset,
      'staff_account_id', staff_row.id
    )
  );

  return jsonb_build_object('grant_id', grant_id);
end;
$$;

-- Extend the patient history payload with the new share fields so the
-- frontend can distinguish patient-initiated tiered shares from legacy
-- staff-requested grants.
create or replace function public.hid_get_patient_history(p_limit integer default 50)
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
            'break_glass', coalesce(request_row.break_glass, false),
            'permission_tier', grant_row.permission_tier,
            'share_target_type', grant_row.share_target_type,
            'share_target_id', grant_row.share_target_id,
            'duration_preset', grant_row.duration_preset
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

commit;
