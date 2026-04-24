begin;

create or replace function public.hid_register_record_file(
  p_record_id uuid,
  p_storage_path text,
  p_original_file_name text,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_sha256_hex text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  record_row public.hid_medical_records;
  version_id uuid;
  file_id uuid;
  expected_prefix text;
begin
  select *
  into record_row
  from public.hid_medical_records
  where id = p_record_id;

  if record_row.id is null then
    raise exception 'Medical record was not found';
  end if;

  if public.hid_current_patient_id() <> record_row.patient_id and not public.hid_has_active_grant(record_row.patient_id, 'write_records') and not public.hid_is_platform_admin() then
    raise exception 'You do not have permission to attach files to this record';
  end if;

  version_id := record_row.current_version_id;
  if version_id is null then
    raise exception 'A current record version is required before attaching files';
  end if;

  expected_prefix := format('patients/%s/records/%s/', record_row.patient_id, p_record_id);
  if coalesce(p_storage_path, '') = '' or left(p_storage_path, length(expected_prefix)) <> expected_prefix then
    raise exception 'File upload path is not valid for this record';
  end if;

  insert into public.hid_medical_record_files (
    record_id,
    record_version_id,
    patient_id,
    storage_path,
    original_file_name,
    mime_type,
    size_bytes,
    sha256_hex,
    uploaded_by_user_profile_id
  )
  values (
    p_record_id,
    version_id,
    record_row.patient_id,
    p_storage_path,
    p_original_file_name,
    p_mime_type,
    p_size_bytes,
    p_sha256_hex,
    public.hid_current_user_profile_id()
  )
  returning id into file_id;

  perform public.hid_log_audit_event(
    'medical_record_file',
    'record_file_registered',
    file_id,
    record_row.patient_id,
    null,
    null,
    jsonb_build_object('record_id', p_record_id)
  );

  return jsonb_build_object('file_id', file_id);
end;
$$;

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
                'created_by_role', coalesce(version_staff.role::text, case when patient_creator.id is not null then 'patient' else version_profile.app_role::text end, 'patient')
              ),
            'current_version',
            coalesce(to_jsonb(version_row), '{}'::jsonb)
              || jsonb_build_object(
                'created_by_name', coalesce(version_staff.full_name, version_profile.display_name, patient_creator.full_name, 'Authorized user'),
                'created_by_role', coalesce(version_staff.role::text, case when patient_creator.id is not null then 'patient' else version_profile.app_role::text end, 'patient')
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
