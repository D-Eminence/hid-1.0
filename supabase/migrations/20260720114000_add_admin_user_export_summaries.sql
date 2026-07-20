begin;

create or replace function public.hid_admin_export_user_summaries(
  p_profile_ids uuid[],
  p_patient_ids uuid[]
)
returns table (
  profile_id uuid,
  notification_count bigint,
  patient_id uuid,
  medical_record_count bigint,
  record_file_count bigint,
  record_file_storage_bytes bigint,
  health_event_count bigint,
  active_access_grant_count bigint,
  pending_access_request_count bigint
)
language sql
security definer
set search_path = public
as $$
  with requested_profiles as (
    select distinct profile_id
    from unnest(coalesce(p_profile_ids, array[]::uuid[])) as ids(profile_id)
  ),
  requested_patients as (
    select distinct patient_id
    from unnest(coalesce(p_patient_ids, array[]::uuid[])) as ids(patient_id)
  ),
  notification_counts as (
    select notifications.user_profile_id as profile_id, count(*)::bigint as notification_count
    from public.hid_notifications notifications
    join requested_profiles profiles on profiles.profile_id = notifications.user_profile_id
    group by notifications.user_profile_id
  ),
  record_counts as (
    select records.patient_id, count(*)::bigint as medical_record_count
    from public.hid_medical_records records
    join requested_patients patients on patients.patient_id = records.patient_id
    group by records.patient_id
  ),
  record_file_counts as (
    select
      files.patient_id,
      count(*)::bigint as record_file_count,
      coalesce(sum(files.size_bytes), 0)::bigint as record_file_storage_bytes
    from public.hid_medical_record_files files
    join requested_patients patients on patients.patient_id = files.patient_id
    group by files.patient_id
  ),
  health_event_counts as (
    select events.patient_id, count(*)::bigint as health_event_count
    from public.hid_health_events events
    join requested_patients patients on patients.patient_id = events.patient_id
    group by events.patient_id
  ),
  grant_counts as (
    select grants.patient_id, count(*)::bigint as active_access_grant_count
    from public.hid_access_grants grants
    join requested_patients patients on patients.patient_id = grants.patient_id
    where grants.status = 'active'
      and (grants.expires_at is null or grants.expires_at > now())
    group by grants.patient_id
  ),
  request_counts as (
    select requests.patient_id, count(*)::bigint as pending_access_request_count
    from public.hid_access_requests requests
    join requested_patients patients on patients.patient_id = requests.patient_id
    where requests.status = 'pending'
    group by requests.patient_id
  )
  select
    profiles.profile_id,
    coalesce(notification_counts.notification_count, 0)::bigint,
    null::uuid,
    null::bigint,
    null::bigint,
    null::bigint,
    null::bigint,
    null::bigint,
    null::bigint
  from requested_profiles profiles
  left join notification_counts on notification_counts.profile_id = profiles.profile_id

  union all

  select
    null::uuid,
    null::bigint,
    patients.patient_id,
    coalesce(record_counts.medical_record_count, 0)::bigint,
    coalesce(record_file_counts.record_file_count, 0)::bigint,
    coalesce(record_file_counts.record_file_storage_bytes, 0)::bigint,
    coalesce(health_event_counts.health_event_count, 0)::bigint,
    coalesce(grant_counts.active_access_grant_count, 0)::bigint,
    coalesce(request_counts.pending_access_request_count, 0)::bigint
  from requested_patients patients
  left join record_counts on record_counts.patient_id = patients.patient_id
  left join record_file_counts on record_file_counts.patient_id = patients.patient_id
  left join health_event_counts on health_event_counts.patient_id = patients.patient_id
  left join grant_counts on grant_counts.patient_id = patients.patient_id
  left join request_counts on request_counts.patient_id = patients.patient_id;
$$;

revoke all on function public.hid_admin_export_user_summaries(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.hid_admin_export_user_summaries(uuid[], uuid[]) to service_role;

commit;
