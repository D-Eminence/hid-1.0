begin;

do $$
declare
  target_emails text[] := array[
    'status-check-1780164035@healthidentitydirectory.com',
    '1603cs040@alhikmah.edu.ng',
    'oliviasmith1607f@gmail.com',
    'e2e-test-1780162557@healthidentitydirectory.com',
    'olamilekandeminencee@gmail.com',
    'verify-chain-test@healthidentitydirectory.com',
    'plottobuild@gmail.com',
    'outreach-smoketest@healthidentitydirectory.com'
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

do $$
declare
  policy_record record;
begin
  if to_regclass('public.hid_outreach_workers') is not null then
    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'hid_outreach_workers'
    loop
      execute format('drop policy if exists %I on public.hid_outreach_workers', policy_record.policyname);
    end loop;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hid_outreach_workers'
        and column_name = 'auth_user_id'
    ) then
      create or replace function public.hid_is_outreach_worker()
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
      as $fn$
        select exists (
          select 1
          from public.hid_outreach_workers workers
          where workers.auth_user_id = auth.uid()
        )
      $fn$;

      grant execute on function public.hid_is_outreach_worker() to authenticated;

      create policy "hid outreach workers own row select"
      on public.hid_outreach_workers
      for select
      to authenticated
      using (auth_user_id = auth.uid() or public.hid_is_platform_admin());

      create policy "hid outreach workers own row update"
      on public.hid_outreach_workers
      for update
      to authenticated
      using (auth_user_id = auth.uid() or public.hid_is_platform_admin())
      with check (auth_user_id = auth.uid() or public.hid_is_platform_admin());
    else
      create policy "hid outreach workers platform admin select"
      on public.hid_outreach_workers
      for select
      to authenticated
      using (public.hid_is_platform_admin());
    end if;
  end if;
end $$;

commit;
