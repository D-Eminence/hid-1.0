begin;

-- Add structured "health information" typing + source verification fields to medical records.
alter table public.hid_medical_records
  add column if not exists info_type text not null default 'document';

alter table public.hid_medical_record_versions
  add column if not exists structured_data jsonb;

-- Backfill info_type from the legacy free-text category column.
update public.hid_medical_records
set info_type = case category
  when 'lab_results' then 'lab_result'
  when 'drug_prescription' then 'medication'
  when 'medical_report' then 'document'
  else 'document'
end
where info_type = 'document';

-- Allow callers to record a structured health-information type + structured fields.
create or replace function public.hid_create_medical_record(
  p_patient_identifier text,
  p_title text,
  p_category text,
  p_record text,
  p_notes text default null,
  p_info_type text default 'document',
  p_structured_data jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_id uuid := public.hid_resolve_patient_identifier(p_patient_identifier);
  record_id uuid;
  version_id uuid;
  profile_id uuid := public.hid_current_user_profile_id();
  staff_id uuid := public.hid_current_staff_account_id();
begin
  if patient_id is null then
    raise exception 'Patient was not found';
  end if;

  if public.hid_current_patient_id() <> patient_id and not public.hid_has_active_grant(patient_id, 'write_records') and not public.hid_is_platform_admin() then
    raise exception 'You do not have permission to create a record for this patient';
  end if;

  insert into public.hid_medical_records (
    patient_id,
    title,
    category,
    info_type,
    created_by_user_profile_id,
    created_by_staff_account_id
  )
  values (
    patient_id,
    coalesce(nullif(trim(p_title), ''), 'Medical Record'),
    coalesce(nullif(trim(p_category), ''), 'other'),
    coalesce(nullif(trim(p_info_type), ''), 'document'),
    profile_id,
    staff_id
  )
  returning id into record_id;

  insert into public.hid_medical_record_versions (
    record_id,
    version_no,
    record,
    notes,
    structured_data,
    created_by_user_profile_id,
    created_by_staff_account_id
  )
  values (
    record_id,
    1,
    trim(p_record),
    nullif(trim(p_notes), ''),
    p_structured_data,
    profile_id,
    staff_id
  )
  returning id into version_id;

  update public.hid_medical_records
  set
    current_version_id = version_id,
    updated_at = now()
  where id = record_id;

  perform public.hid_log_audit_event(
    'medical_record',
    'record_created',
    record_id,
    patient_id,
    null,
    null,
    jsonb_build_object('version_id', version_id)
  );

  return jsonb_build_object('record_id', record_id, 'version_id', version_id);
end;
$$;

-- Surface contributor organization + verification status alongside each record/version.
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
                'created_by_role', coalesce(version_staff.role::text, case when patient_creator.id is not null then 'patient' else version_profile.app_role::text end, 'patient'),
                'created_by_org', version_staff.hospital_name,
                'created_by_verified', coalesce(version_staff.verification_status = 'verified', false)
              ),
            'current_version',
            coalesce(to_jsonb(version_row), '{}'::jsonb)
              || jsonb_build_object(
                'created_by_name', coalesce(version_staff.full_name, version_profile.display_name, patient_creator.full_name, 'Authorized user'),
                'created_by_role', coalesce(version_staff.role::text, case when patient_creator.id is not null then 'patient' else version_profile.app_role::text end, 'patient'),
                'created_by_org', version_staff.hospital_name,
                'created_by_verified', coalesce(version_staff.verification_status = 'verified', false)
              ),
            'files', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', file_row.id,
                    'record_id', file_row.record_id,
                    'record_version_id', file_row.record_version_id,
                    'patient_id', file_row.patient_id,
                    'original_file_name', file_row.original_file_name,
                    'mime_type', file_row.mime_type,
                    'size_bytes', file_row.size_bytes,
                    'uploaded_by_user_profile_id', file_row.uploaded_by_user_profile_id,
                    'created_at', file_row.created_at
                  )
                  order by file_row.created_at
                ),
                '[]'::jsonb
              )
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

commit;
