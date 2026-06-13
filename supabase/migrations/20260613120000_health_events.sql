begin;

-- Health Events group related medical records into episodes (e.g. "Flu - March 2026")
-- so they can be viewed and later shared as a single unit.
create table if not exists public.hid_health_events (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.hid_patients(id) on delete cascade,
  title text not null default 'Health event',
  info_category text not null default 'general',
  status text not null default 'open' check (status in ('open', 'closed')),
  started_at date,
  ended_at date,
  created_by_user_profile_id uuid not null references public.hid_user_profiles(id) on delete restrict,
  created_by_staff_account_id uuid references public.hid_staff_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hid_health_events_patient_created on public.hid_health_events(patient_id, created_at desc);

create table if not exists public.hid_health_event_records (
  id uuid primary key default gen_random_uuid(),
  health_event_id uuid not null references public.hid_health_events(id) on delete cascade,
  record_id uuid not null references public.hid_medical_records(id) on delete cascade,
  added_by_user_profile_id uuid references public.hid_user_profiles(id) on delete set null,
  added_by_staff_account_id uuid references public.hid_staff_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (health_event_id, record_id)
);

create index if not exists idx_hid_health_event_records_event on public.hid_health_event_records(health_event_id);
create index if not exists idx_hid_health_event_records_record on public.hid_health_event_records(record_id);

drop trigger if exists hid_health_events_set_updated_at on public.hid_health_events;
create trigger hid_health_events_set_updated_at before update on public.hid_health_events for each row execute function public.hid_set_updated_at();

alter table public.hid_health_events enable row level security;
alter table public.hid_health_event_records enable row level security;

drop policy if exists "hid health events self or granted select" on public.hid_health_events;
create policy "hid health events self or granted select" on public.hid_health_events for select to authenticated using (
  patient_id = public.hid_current_patient_id()
  or public.hid_has_active_grant(patient_id, 'read_records')
  or public.hid_is_platform_admin()
);

drop policy if exists "hid health event records self or granted select" on public.hid_health_event_records;
create policy "hid health event records self or granted select" on public.hid_health_event_records for select to authenticated using (
  exists (
    select 1
    from public.hid_health_events event_row
    where event_row.id = health_event_id
      and (
        event_row.patient_id = public.hid_current_patient_id()
        or public.hid_has_active_grant(event_row.patient_id, 'read_records')
        or public.hid_is_platform_admin()
      )
  )
);

-- All writes go through the security-definer RPCs below, which perform their own
-- permission checks, so no insert/update/delete policies are required here.

create or replace function public.hid_get_patient_health_events(p_patient_identifier text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_patient_id uuid;
  result jsonb;
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

  select coalesce(
    jsonb_agg(
      to_jsonb(event_row) || jsonb_build_object(
        'record_ids', (
          select coalesce(jsonb_agg(her.record_id order by her.created_at), '[]'::jsonb)
          from public.hid_health_event_records her
          where her.health_event_id = event_row.id
        )
      )
      order by event_row.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from public.hid_health_events event_row
  where event_row.patient_id = target_patient_id;

  return result;
end;
$$;

create or replace function public.hid_create_health_event(
  p_patient_identifier text,
  p_title text,
  p_info_category text default 'general',
  p_record_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_patient_id uuid := public.hid_resolve_patient_identifier(p_patient_identifier);
  event_id uuid;
  profile_id uuid := public.hid_current_user_profile_id();
  staff_id uuid := public.hid_current_staff_account_id();
  record_id uuid;
begin
  if target_patient_id is null then
    raise exception 'Patient was not found';
  end if;

  if public.hid_current_patient_id() <> target_patient_id and not public.hid_has_active_grant(target_patient_id, 'write_records') and not public.hid_is_platform_admin() then
    raise exception 'You do not have permission to create a health event for this patient';
  end if;

  insert into public.hid_health_events (patient_id, title, info_category, created_by_user_profile_id, created_by_staff_account_id)
  values (
    target_patient_id,
    coalesce(nullif(trim(p_title), ''), 'Health event'),
    coalesce(nullif(trim(p_info_category), ''), 'general'),
    profile_id,
    staff_id
  )
  returning id into event_id;

  if p_record_ids is not null then
    foreach record_id in array p_record_ids loop
      if exists (select 1 from public.hid_medical_records r where r.id = record_id and r.patient_id = target_patient_id) then
        insert into public.hid_health_event_records (health_event_id, record_id, added_by_user_profile_id, added_by_staff_account_id)
        values (event_id, record_id, profile_id, staff_id)
        on conflict (health_event_id, record_id) do nothing;
      end if;
    end loop;
  end if;

  perform public.hid_log_audit_event(
    'health_event',
    'event_created',
    event_id,
    target_patient_id,
    null,
    null,
    jsonb_build_object('title', p_title)
  );

  return jsonb_build_object('event_id', event_id);
end;
$$;

create or replace function public.hid_update_health_event(
  p_health_event_id uuid,
  p_title text default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid;
begin
  select patient_id into v_patient_id from public.hid_health_events where id = p_health_event_id;
  if v_patient_id is null then
    raise exception 'Health event was not found';
  end if;

  if public.hid_current_patient_id() <> v_patient_id and not public.hid_has_active_grant(v_patient_id, 'write_records') and not public.hid_is_platform_admin() then
    raise exception 'You do not have permission to modify this health event';
  end if;

  if p_status is not null and p_status not in ('open', 'closed') then
    raise exception 'Invalid status';
  end if;

  update public.hid_health_events
  set
    title = coalesce(nullif(trim(p_title), ''), title),
    status = coalesce(p_status, status),
    ended_at = case when p_status = 'closed' and ended_at is null then current_date else ended_at end,
    updated_at = now()
  where id = p_health_event_id;

  perform public.hid_log_audit_event(
    'health_event',
    'event_updated',
    p_health_event_id,
    v_patient_id,
    null,
    null,
    jsonb_build_object('title', p_title, 'status', p_status)
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.hid_add_record_to_health_event(
  p_health_event_id uuid,
  p_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid;
  v_record_patient_id uuid;
  profile_id uuid := public.hid_current_user_profile_id();
  staff_id uuid := public.hid_current_staff_account_id();
begin
  select patient_id into v_patient_id from public.hid_health_events where id = p_health_event_id;
  if v_patient_id is null then
    raise exception 'Health event was not found';
  end if;

  select patient_id into v_record_patient_id from public.hid_medical_records where id = p_record_id;
  if v_record_patient_id is null or v_record_patient_id <> v_patient_id then
    raise exception 'This record does not belong to the same patient as the health event';
  end if;

  if public.hid_current_patient_id() <> v_patient_id and not public.hid_has_active_grant(v_patient_id, 'write_records') and not public.hid_is_platform_admin() then
    raise exception 'You do not have permission to modify this health event';
  end if;

  insert into public.hid_health_event_records (health_event_id, record_id, added_by_user_profile_id, added_by_staff_account_id)
  values (p_health_event_id, p_record_id, profile_id, staff_id)
  on conflict (health_event_id, record_id) do nothing;

  perform public.hid_log_audit_event(
    'health_event',
    'record_added_to_event',
    p_health_event_id,
    v_patient_id,
    null,
    null,
    jsonb_build_object('record_id', p_record_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.hid_remove_record_from_health_event(
  p_health_event_id uuid,
  p_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid;
begin
  select patient_id into v_patient_id from public.hid_health_events where id = p_health_event_id;
  if v_patient_id is null then
    raise exception 'Health event was not found';
  end if;

  if public.hid_current_patient_id() <> v_patient_id and not public.hid_has_active_grant(v_patient_id, 'write_records') and not public.hid_is_platform_admin() then
    raise exception 'You do not have permission to modify this health event';
  end if;

  delete from public.hid_health_event_records where health_event_id = p_health_event_id and record_id = p_record_id;

  perform public.hid_log_audit_event(
    'health_event',
    'record_removed_from_event',
    p_health_event_id,
    v_patient_id,
    null,
    null,
    jsonb_build_object('record_id', p_record_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;

commit;
