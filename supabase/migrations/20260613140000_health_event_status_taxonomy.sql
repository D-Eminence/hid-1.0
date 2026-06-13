begin;

-- Expand health event status from open/closed to a richer taxonomy that reflects
-- where a patient is in a healthcare journey.
update public.hid_health_events set status = 'active' where status = 'open';
update public.hid_health_events set status = 'resolved' where status = 'closed';

alter table public.hid_health_events drop constraint if exists hid_health_events_status_check;
alter table public.hid_health_events add constraint hid_health_events_status_check
  check (status in ('active', 'monitoring', 'resolved', 'archived'));

alter table public.hid_health_events alter column status set default 'active';

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

  if p_status is not null and p_status not in ('active', 'monitoring', 'resolved', 'archived') then
    raise exception 'Invalid status';
  end if;

  update public.hid_health_events
  set
    title = coalesce(nullif(trim(p_title), ''), title),
    status = coalesce(p_status, status),
    ended_at = case when p_status in ('resolved', 'archived') and ended_at is null then current_date else ended_at end,
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

commit;
