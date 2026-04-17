begin;

create table if not exists public.hid_auth_challenges (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.hid_patients(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  challenge_type text not null check (challenge_type in ('patient_password_reset', 'account_deletion')),
  otp_hash text not null,
  otp_length integer not null check (otp_length between 4 and 10),
  delivery_channels jsonb not null default '[]'::jsonb,
  delivery_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  expires_at timestamptz not null,
  verified_at timestamptz,
  verification_token_hash text,
  verification_token_expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hid_auth_challenges_patient_created
  on public.hid_auth_challenges(patient_id, created_at desc);

create index if not exists idx_hid_auth_challenges_auth_type_active
  on public.hid_auth_challenges(auth_user_id, challenge_type, expires_at desc)
  where consumed_at is null;

drop trigger if exists hid_set_updated_at_auth_challenges on public.hid_auth_challenges;
create trigger hid_set_updated_at_auth_challenges
  before update on public.hid_auth_challenges
  for each row execute procedure public.hid_set_updated_at();

alter table public.hid_auth_challenges enable row level security;

commit;
