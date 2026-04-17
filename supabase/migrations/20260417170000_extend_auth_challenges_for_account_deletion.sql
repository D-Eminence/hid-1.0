begin;

alter table public.hid_auth_challenges
  alter column patient_id drop not null;

alter table public.hid_auth_challenges
  drop constraint if exists hid_auth_challenges_challenge_type_check;

alter table public.hid_auth_challenges
  add constraint hid_auth_challenges_challenge_type_check
  check (challenge_type in ('patient_password_reset', 'account_deletion'));

commit;
