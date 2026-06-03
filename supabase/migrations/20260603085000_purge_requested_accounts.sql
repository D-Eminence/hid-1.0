begin;

do $$
declare
  target_emails text[] := array[
    'cryptos455@gmail.com',
    'philiphoward120@gmail.com'
  ];
begin
  create temporary table if not exists hid_purge_target_auth_users (
    auth_user_id uuid primary key
  ) on commit drop;

  insert into hid_purge_target_auth_users (auth_user_id)
  select users.id
  from auth.users as users
  where lower(users.email) = any(target_emails)
  on conflict do nothing;

  create temporary table if not exists hid_purge_target_profiles (
    profile_id uuid primary key
  ) on commit drop;

  insert into hid_purge_target_profiles (profile_id)
  select profiles.id
  from public.hid_user_profiles as profiles
  where profiles.auth_user_id in (select auth_user_id from hid_purge_target_auth_users)
  on conflict do nothing;

  create temporary table if not exists hid_purge_target_patients (
    patient_id uuid primary key
  ) on commit drop;

  insert into hid_purge_target_patients (patient_id)
  select patients.id
  from public.hid_patients as patients
  where patients.auth_user_id in (select auth_user_id from hid_purge_target_auth_users)
     or patients.user_profile_id in (select profile_id from hid_purge_target_profiles)
     or lower(patients.email::text) = any(target_emails)
  on conflict do nothing;

  create temporary table if not exists hid_purge_target_staff (
    staff_account_id uuid primary key
  ) on commit drop;

  insert into hid_purge_target_staff (staff_account_id)
  select staff.id
  from public.hid_staff_accounts as staff
  where staff.auth_user_id in (select auth_user_id from hid_purge_target_auth_users)
     or staff.user_profile_id in (select profile_id from hid_purge_target_profiles)
     or lower(staff.email::text) = any(target_emails)
  on conflict do nothing;

  begin
    alter table public.hid_audit_events disable trigger hid_no_update_audit_events;

    delete from public.hid_audit_events
    where actor_user_id in (select auth_user_id from hid_purge_target_auth_users)
       or actor_profile_id in (select profile_id from hid_purge_target_profiles)
       or patient_id in (select patient_id from hid_purge_target_patients);

    alter table public.hid_audit_events enable trigger hid_no_update_audit_events;
  exception
    when others then
      alter table public.hid_audit_events enable trigger hid_no_update_audit_events;
      raise;
  end;

  delete from public.hid_notifications
  where user_profile_id in (select profile_id from hid_purge_target_profiles)
     or patient_id in (select patient_id from hid_purge_target_patients);

  delete from public.hid_staff_invites
  where lower(email::text) = any(target_emails)
     or invited_by_user_profile_id in (select profile_id from hid_purge_target_profiles);

  delete from public.hid_access_grants
  where patient_id in (select patient_id from hid_purge_target_patients)
     or staff_account_id in (select staff_account_id from hid_purge_target_staff);

  delete from public.hid_access_requests
  where patient_id in (select patient_id from hid_purge_target_patients)
     or requester_staff_account_id in (select staff_account_id from hid_purge_target_staff);

  delete from public.hid_medical_records
  where patient_id in (select patient_id from hid_purge_target_patients)
     or created_by_user_profile_id in (select profile_id from hid_purge_target_profiles)
     or exists (
       select 1
       from public.hid_medical_record_versions as versions
       where versions.record_id = hid_medical_records.id
         and versions.created_by_user_profile_id in (select profile_id from hid_purge_target_profiles)
     );

  delete from public.hid_medical_record_files
  where uploaded_by_user_profile_id in (select profile_id from hid_purge_target_profiles)
     or patient_id in (select patient_id from hid_purge_target_patients);

  delete from public.hid_patient_identifiers
  where patient_id in (select patient_id from hid_purge_target_patients)
     or (
       identifier_type = 'email'
       and lower(normalized_value) = any(target_emails)
     );

  delete from public.hid_auth_challenges
  where auth_user_id in (select auth_user_id from hid_purge_target_auth_users)
     or patient_id in (select patient_id from hid_purge_target_patients);

  delete from public.hid_staff_accounts
  where id in (select staff_account_id from hid_purge_target_staff);

  delete from public.hid_patients
  where id in (select patient_id from hid_purge_target_patients);

  delete from public.hid_user_profiles
  where id in (select profile_id from hid_purge_target_profiles)
     or auth_user_id in (select auth_user_id from hid_purge_target_auth_users);

  delete from auth.users
  where id in (select auth_user_id from hid_purge_target_auth_users)
     or lower(email) = any(target_emails);
end $$;

commit;
