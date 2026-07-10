begin;

alter table public.hid_auth_challenges
  drop constraint if exists hid_auth_challenges_challenge_type_check;

alter table public.hid_auth_challenges
  add constraint hid_auth_challenges_challenge_type_check
  check (challenge_type in (
    'patient_password_reset',
    'account_deletion',
    'patient_signup',
    'hospital_signup',
    'admin_export'
  ));

create index if not exists idx_hid_auth_challenges_admin_export
  on public.hid_auth_challenges(auth_user_id, created_at desc)
  where challenge_type = 'admin_export' and consumed_at is null;

commit;
