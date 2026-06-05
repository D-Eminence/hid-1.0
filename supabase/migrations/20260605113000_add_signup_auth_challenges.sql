begin;

alter table public.hid_auth_challenges
  drop constraint if exists hid_auth_challenges_challenge_type_check;

alter table public.hid_auth_challenges
  add constraint hid_auth_challenges_challenge_type_check
  check (challenge_type in (
    'patient_password_reset',
    'account_deletion',
    'patient_signup',
    'hospital_signup'
  ));

create index if not exists idx_hid_auth_challenges_signup_email
  on public.hid_auth_challenges(auth_user_id, challenge_type, created_at desc)
  where challenge_type in ('patient_signup', 'hospital_signup') and consumed_at is null;

commit;
