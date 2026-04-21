create index if not exists idx_hid_notifications_profile_unread_created
  on public.hid_notifications(user_profile_id, created_at desc)
  where read_at is null;

create index if not exists idx_hid_staff_memberships_staff_primary_active
  on public.hid_staff_memberships(staff_account_id, created_at desc)
  where is_primary = true and active = true;

create index if not exists idx_hid_record_files_patient_created
  on public.hid_medical_record_files(patient_id, created_at desc);

create index if not exists idx_hid_record_files_uploader_created
  on public.hid_medical_record_files(uploaded_by_user_profile_id, created_at desc);

create index if not exists idx_hid_record_files_created_desc
  on public.hid_medical_record_files(created_at desc);

create or replace function public.hid_total_record_file_bytes()
returns bigint
language sql
stable
as $$
  select coalesce(sum(size_bytes), 0)::bigint
  from public.hid_medical_record_files
  where size_bytes is not null
$$;

grant execute on function public.hid_total_record_file_bytes() to authenticated;
