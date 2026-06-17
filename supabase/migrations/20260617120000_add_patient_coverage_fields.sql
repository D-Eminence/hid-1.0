begin;

alter table public.hid_patients
  add column if not exists hospital_currently_using text,
  add column if not exists hmo_organization text;

create or replace function public.hid_register_patient_profile(
  p_first_name text,
  p_last_name text,
  p_hospital_currently_using text default null,
  p_gender text default null,
  p_dob date default null,
  p_phone_e164 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_id uuid := public.hid_current_user_profile_id();
  auth_email text;
  auth_phone text;
  patient_id uuid;
  hid_code_value text;
  full_name_value text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if exists (select 1 from public.hid_patients where auth_user_id = auth.uid()) then
    raise exception 'Patient profile already exists';
  end if;

  select email, phone
  into auth_email, auth_phone
  from auth.users
  where id = auth.uid();

  full_name_value := trim(concat(coalesce(p_first_name, ''), ' ', coalesce(p_last_name, '')));
  hid_code_value := public.hid_generate_hid_code();

  update public.hid_user_profiles
  set
    app_role = 'patient',
    display_name = full_name_value,
    updated_at = now()
  where id = profile_id;

  insert into public.hid_patients (
    user_profile_id,
    auth_user_id,
    hid_code,
    first_name,
    last_name,
    full_name,
    phone_e164,
    email,
    hospital_currently_using,
    gender,
    dob
  )
  values (
    profile_id,
    auth.uid(),
    hid_code_value,
    trim(p_first_name),
    trim(p_last_name),
    full_name_value,
    coalesce(public.hid_normalize_phone(p_phone_e164), public.hid_normalize_phone(auth_phone)),
    nullif(lower(auth_email), ''),
    nullif(trim(p_hospital_currently_using), ''),
    nullif(trim(p_gender), ''),
    p_dob
  )
  returning id into patient_id;

  perform public.hid_log_audit_event(
    'patient_profile',
    'patient_registered',
    patient_id,
    patient_id,
    null,
    null,
    jsonb_build_object('hid_code', hid_code_value)
  );

  return jsonb_build_object('patient_id', patient_id, 'hid_code', hid_code_value);
end;
$$;

commit;
