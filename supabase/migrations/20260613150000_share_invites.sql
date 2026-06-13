begin;

-- Patients can invite a provider who isn't on HID yet (or isn't verified) by
-- email. The invite stays pending until a staff account with that email
-- becomes verified with an active membership, at which point it is
-- automatically converted into a real access grant.
create table if not exists public.hid_share_invites (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.hid_patients(id) on delete cascade,
  invited_email citext not null,
  invited_name text,
  permission_tier public.hid_share_permission_tier not null,
  duration_preset text not null check (duration_preset in ('24h', '7d', '30d', 'until_revoked')),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'activated', 'cancelled', 'expired')),
  granted_by_patient_id uuid references public.hid_patients(id) on delete set null,
  activated_grant_id uuid references public.hid_access_grants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_hid_share_invites_patient_email_pending
  on public.hid_share_invites(patient_id, invited_email)
  where status = 'pending';

create index if not exists idx_hid_share_invites_email_pending
  on public.hid_share_invites(invited_email)
  where status = 'pending';

drop trigger if exists hid_share_invites_set_updated_at on public.hid_share_invites;
create trigger hid_share_invites_set_updated_at before update on public.hid_share_invites for each row execute function public.hid_set_updated_at();

alter table public.hid_share_invites enable row level security;

drop policy if exists "hid share invites patient select" on public.hid_share_invites;
create policy "hid share invites patient select" on public.hid_share_invites for select to authenticated using (
  patient_id = public.hid_current_patient_id()
);

-- Shared grant-creation logic, extracted from hid_create_share so the
-- auto-activation path (below) can produce identical access grants.
create or replace function public.hid_activate_share(
  p_patient_id uuid,
  p_staff_row public.hid_staff_accounts,
  p_membership_row public.hid_staff_memberships,
  p_permission_tier public.hid_share_permission_tier,
  p_duration_preset text,
  p_reason text,
  p_share_invite_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_scope public.hid_access_scope;
  grant_expires_at timestamptz;
  grant_id uuid;
  tier_label text;
begin
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
    p_patient_id,
    p_staff_row.id,
    p_membership_row.id,
    grant_scope,
    p_permission_tier,
    'profile',
    p_duration_preset,
    p_patient_id,
    coalesce(nullif(trim(p_reason), ''), case when p_share_invite_id is not null then 'Connected via invite' else 'Shared by patient' end),
    now(),
    grant_expires_at,
    p_staff_row.full_name
  )
  returning id into grant_id;

  perform public.hid_create_notification(
    p_staff_row.user_profile_id,
    p_patient_id,
    'Profile shared with you',
    'A patient shared their profile with you (' || tier_label || ' access).',
    'access_granted'
  );

  perform public.hid_log_audit_event(
    'patient_share',
    case when p_share_invite_id is not null then 'share_invite_activated' else 'share_created' end,
    grant_id,
    p_patient_id,
    p_membership_row.organization_id,
    p_reason,
    jsonb_build_object(
      'permission_tier', p_permission_tier,
      'duration_preset', p_duration_preset,
      'staff_account_id', p_staff_row.id,
      'share_invite_id', p_share_invite_id
    )
  );

  return grant_id;
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
  grant_id uuid;
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

  grant_id := public.hid_activate_share(patient_id, staff_row, membership_row, p_permission_tier, p_duration_preset, p_reason);

  return jsonb_build_object('grant_id', grant_id);
end;
$$;

-- Patient invites a provider (by email) who isn't searchable on HID yet. If
-- the email already belongs to a verified, active provider with an active
-- membership, share immediately instead of creating a pending invite.
create or replace function public.hid_create_share_invite(
  p_email text,
  p_full_name text,
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
  normalized_email_text text := lower(trim(coalesce(p_email, '')));
  normalized_email citext;
  staff_row public.hid_staff_accounts;
  membership_row public.hid_staff_memberships;
  grant_id uuid;
  invite_id uuid;
begin
  if patient_id is null then
    raise exception 'Only patients can invite providers';
  end if;

  if p_duration_preset not in ('24h', '7d', '30d', 'until_revoked') then
    raise exception 'Invalid duration preset';
  end if;

  if normalized_email_text = '' or normalized_email_text !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;

  normalized_email := normalized_email_text::citext;

  select *
  into staff_row
  from public.hid_staff_accounts
  where email = normalized_email
    and active = true
    and verification_status = 'verified';

  if staff_row.id is not null then
    select *
    into membership_row
    from public.hid_staff_memberships
    where staff_account_id = staff_row.id
      and active = true
    order by is_primary desc, updated_at desc nulls last, created_at desc
    limit 1;
  end if;

  if staff_row.id is not null and membership_row.id is not null then
    grant_id := public.hid_activate_share(patient_id, staff_row, membership_row, p_permission_tier, p_duration_preset, p_reason);
    return jsonb_build_object('mode', 'connected', 'grant_id', grant_id);
  end if;

  insert into public.hid_share_invites (
    patient_id,
    invited_email,
    invited_name,
    permission_tier,
    duration_preset,
    reason,
    granted_by_patient_id
  )
  values (
    patient_id,
    normalized_email,
    nullif(trim(p_full_name), ''),
    p_permission_tier,
    p_duration_preset,
    nullif(trim(p_reason), ''),
    patient_id
  )
  on conflict (patient_id, invited_email) where status = 'pending'
  do update set
    invited_name = excluded.invited_name,
    permission_tier = excluded.permission_tier,
    duration_preset = excluded.duration_preset,
    reason = excluded.reason,
    updated_at = now()
  returning id into invite_id;

  perform public.hid_log_audit_event(
    'patient_share',
    'share_invite_sent',
    invite_id,
    patient_id,
    null,
    p_reason,
    jsonb_build_object(
      'invited_email', normalized_email,
      'permission_tier', p_permission_tier,
      'duration_preset', p_duration_preset
    )
  );

  return jsonb_build_object('mode', 'invited', 'invite_id', invite_id);
end;
$$;

-- Activates any pending share invites addressed to a now-verified staff
-- account with an active membership, converting them into real access
-- grants. Called from triggers below whenever a staff account or membership
-- becomes active/verified.
create or replace function public.hid_activate_share_invites_for_staff(p_staff_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_row public.hid_staff_accounts;
  membership_row public.hid_staff_memberships;
  invite_row public.hid_share_invites;
  grant_id uuid;
  patient_profile_id uuid;
  tier_label text;
begin
  select *
  into staff_row
  from public.hid_staff_accounts
  where id = p_staff_account_id
    and active = true
    and verification_status = 'verified';

  if staff_row.id is null then
    return;
  end if;

  select *
  into membership_row
  from public.hid_staff_memberships
  where staff_account_id = staff_row.id
    and active = true
  order by is_primary desc, updated_at desc nulls last, created_at desc
  limit 1;

  if membership_row.id is null then
    return;
  end if;

  for invite_row in
    select *
    from public.hid_share_invites
    where status = 'pending'
      and invited_email = staff_row.email
    for update
  loop
    grant_id := public.hid_activate_share(
      invite_row.patient_id,
      staff_row,
      membership_row,
      invite_row.permission_tier,
      invite_row.duration_preset,
      invite_row.reason,
      invite_row.id
    );

    update public.hid_share_invites
    set status = 'activated', activated_grant_id = grant_id, updated_at = now()
    where id = invite_row.id;

    select user_profile_id into patient_profile_id
    from public.hid_patients
    where id = invite_row.patient_id;

    if patient_profile_id is not null then
      tier_label := case invite_row.permission_tier
        when 'clinical_collaboration' then 'Clinical Collaboration'
        when 'clinical_review' then 'Clinical Review'
        else 'View Only'
      end;

      perform public.hid_create_notification(
        patient_profile_id,
        invite_row.patient_id,
        'Provider joined HID',
        coalesce(invite_row.invited_name, staff_row.full_name) || ' has joined HID and now has ' || tier_label || ' access to your profile.',
        'access_granted'
      );
    end if;
  end loop;
end;
$$;

create or replace function public.hid_staff_accounts_activate_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status = 'verified' and new.active = true then
    perform public.hid_activate_share_invites_for_staff(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists hid_staff_accounts_activate_invites on public.hid_staff_accounts;
create trigger hid_staff_accounts_activate_invites
  after insert or update on public.hid_staff_accounts
  for each row execute function public.hid_staff_accounts_activate_invites();

create or replace function public.hid_staff_memberships_activate_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.active = true then
    perform public.hid_activate_share_invites_for_staff(new.staff_account_id);
  end if;
  return new;
end;
$$;

drop trigger if exists hid_staff_memberships_activate_invites on public.hid_staff_memberships;
create trigger hid_staff_memberships_activate_invites
  after insert or update on public.hid_staff_memberships
  for each row execute function public.hid_staff_memberships_activate_invites();

-- Patient cancels their own pending invite.
create or replace function public.hid_cancel_share_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid := public.hid_current_patient_id();
  updated_id uuid;
begin
  if v_patient_id is null then
    raise exception 'Only patients can cancel invites';
  end if;

  update public.hid_share_invites
  set status = 'cancelled', updated_at = now()
  where id = p_invite_id
    and patient_id = v_patient_id
    and status = 'pending'
  returning id into updated_id;

  if updated_id is null then
    raise exception 'Invitation not found';
  end if;

  return jsonb_build_object('invite_id', updated_id);
end;
$$;

-- Extend the patient access-history payload with pending share invites so
-- the frontend can show "Invitation sent, waiting for provider to join HID".
create or replace function public.hid_list_my_access_history(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid := public.hid_current_patient_id();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
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
      where grant_row.patient_id = v_patient_id
        and grant_row.status = 'active'
        and grant_row.expires_at > now()
    ),
    'pending_invites', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'invite_id', invite_row.id,
            'invited_email', invite_row.invited_email,
            'invited_name', invite_row.invited_name,
            'permission_tier', invite_row.permission_tier,
            'duration_preset', invite_row.duration_preset,
            'reason', invite_row.reason,
            'status', invite_row.status,
            'created_at', invite_row.created_at
          )
          order by invite_row.created_at desc
        ),
        '[]'::jsonb
      )
      from public.hid_share_invites invite_row
      where invite_row.patient_id = v_patient_id
        and invite_row.status = 'pending'
    ),
    'events', (
      with recent_audit_rows as (
        select
          audit_row.event_id,
          audit_row.action,
          audit_row.resource_type,
          audit_row.reason,
          audit_row.created_at,
          audit_row.metadata,
          audit_row.actor_profile_id
        from public.hid_audit_events audit_row
        where audit_row.patient_id = v_patient_id
        order by audit_row.created_at desc
        limit v_limit
      )
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
        from recent_audit_rows audit_row
        left join public.hid_user_profiles profile_row on profile_row.id = audit_row.actor_profile_id
        left join public.hid_staff_accounts staff_row on staff_row.user_profile_id = audit_row.actor_profile_id
      ) event_rows
    )
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
