
  begin;

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists citext;

do $$
begin
  create type public.hid_app_role as enum ('patient', 'clinician', 'org_admin', 'platform_admin');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.hid_staff_role as enum ('doctor', 'nurse', 'lab', 'pharmacist', 'admin');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.hid_access_scope as enum ('read_records', 'write_records', 'break_glass');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.hid_request_status as enum ('pending', 'approved', 'denied', 'revoked', 'expired');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.hid_grant_status as enum ('active', 'revoked', 'expired');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.hid_invite_status as enum ('pending', 'accepted', 'expired', 'revoked');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.hid_allowed_staff_domains (
  domain text primary key,
  active boolean not null default true,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.hid_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hid_facilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hid_organizations(id) on delete cascade,
  name text not null,
  code text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hid_user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  app_role public.hid_app_role not null default 'patient',
  display_name text,
  active boolean not null default true,
  mfa_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hid_patients (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null unique references public.hid_user_profiles(id) on delete cascade,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  hid_code text not null unique,
  first_name text not null,
  last_name text not null,
  full_name text not null,
  phone_e164 text,
  email citext,
  gender text,
  dob date,
  blood_group text default 'Unknown',
  genotype text,
  country text,
  state text,
  allergies text,
  chronic_conditions text,
  current_medications text,
  photo_url text,
  emergency_contact_name text,
  emergency_contact_relationship text,
  emergency_contact_phone text,
  emergency_contact_address text,
  medical_notes text,
  nin_last4 text,
  nin_hash text,
  nin_ciphertext text,
  notifications_enabled boolean not null default true,
  profile_percent integer not null default 0 check (profile_percent between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_hid_patients_phone on public.hid_patients(phone_e164) where phone_e164 is not null;
create unique index if not exists idx_hid_patients_email on public.hid_patients(email) where email is not null;

create table if not exists public.hid_patient_identifiers (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.hid_patients(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('hid_code', 'phone', 'email')),
  raw_value text not null,
  normalized_value text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (identifier_type, normalized_value)
);

create table if not exists public.hid_staff_accounts (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null unique references public.hid_user_profiles(id) on delete cascade,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  email citext not null unique,
  hospital_name text,
  verification_status text not null default 'pending_invite',
  license_number text,
  role public.hid_staff_role not null default 'doctor',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hid_staff_memberships (
  id uuid primary key default gen_random_uuid(),
  staff_account_id uuid not null references public.hid_staff_accounts(id) on delete cascade,
  organization_id uuid not null references public.hid_organizations(id) on delete cascade,
  facility_id uuid references public.hid_facilities(id) on delete set null,
  membership_role public.hid_staff_role not null,
  app_role public.hid_app_role not null default 'clinician',
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_account_id, organization_id, facility_id, membership_role)
);

create table if not exists public.hid_staff_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hid_organizations(id) on delete cascade,
  facility_id uuid references public.hid_facilities(id) on delete set null,
  email citext not null,
  membership_role public.hid_staff_role not null,
  app_role public.hid_app_role not null default 'clinician',
  invited_by_user_profile_id uuid not null references public.hid_user_profiles(id) on delete restrict,
  status public.hid_invite_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_hid_staff_invites_active_email on public.hid_staff_invites(organization_id, email)
  where status = 'pending';

create table if not exists public.hid_access_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.hid_patients(id) on delete cascade,
  requester_staff_account_id uuid not null references public.hid_staff_accounts(id) on delete cascade,
  requester_membership_id uuid not null references public.hid_staff_memberships(id) on delete cascade,
  scope public.hid_access_scope not null default 'read_records',
  reason text not null,
  status public.hid_request_status not null default 'pending',
  requested_duration_minutes integer not null default 60 check (requested_duration_minutes between 5 and 1440),
  break_glass boolean not null default false,
  approved_by_patient_id uuid references public.hid_patients(id) on delete set null,
  approved_at timestamptz,
  denied_at timestamptz,
  denied_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hid_access_requests_patient_status on public.hid_access_requests(patient_id, status, created_at desc);
create index if not exists idx_hid_access_requests_staff_status on public.hid_access_requests(requester_staff_account_id, status, created_at desc);

create table if not exists public.hid_access_grants (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.hid_access_requests(id) on delete set null,
  patient_id uuid not null references public.hid_patients(id) on delete cascade,
  staff_account_id uuid not null references public.hid_staff_accounts(id) on delete cascade,
  membership_id uuid not null references public.hid_staff_memberships(id) on delete cascade,
  scope public.hid_access_scope not null,
  status public.hid_grant_status not null default 'active',
  granted_by_patient_id uuid references public.hid_patients(id) on delete set null,
  reason text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by_user_profile_id uuid references public.hid_user_profiles(id) on delete set null,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hid_access_grants_patient_status on public.hid_access_grants(patient_id, status, expires_at desc);
create index if not exists idx_hid_access_grants_staff_status on public.hid_access_grants(staff_account_id, status, expires_at desc);

create table if not exists public.hid_medical_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.hid_patients(id) on delete cascade,
  title text not null default 'Medical Record',
  category text not null default 'other',
  created_by_user_profile_id uuid not null references public.hid_user_profiles(id) on delete restrict,
  created_by_staff_account_id uuid references public.hid_staff_accounts(id) on delete set null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hid_medical_records_patient_created on public.hid_medical_records(patient_id, created_at desc);

create table if not exists public.hid_medical_record_versions (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.hid_medical_records(id) on delete cascade,
  version_no integer not null,
  record text not null,
  notes text,
  transcription_text text,
  created_by_user_profile_id uuid not null references public.hid_user_profiles(id) on delete restrict,
  created_by_staff_account_id uuid references public.hid_staff_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (record_id, version_no)
);

create table if not exists public.hid_medical_record_files (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.hid_medical_records(id) on delete cascade,
  record_version_id uuid not null references public.hid_medical_record_versions(id) on delete cascade,
  patient_id uuid not null references public.hid_patients(id) on delete cascade,
  storage_bucket text not null default 'medical-record-files',
  storage_path text not null unique,
  original_file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  sha256_hex text,
  uploaded_by_user_profile_id uuid not null references public.hid_user_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_hid_record_files_record_created on public.hid_medical_record_files(record_id, created_at);

create table if not exists public.hid_notifications (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.hid_user_profiles(id) on delete cascade,
  patient_id uuid references public.hid_patients(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'system',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_hid_notifications_profile_created on public.hid_notifications(user_profile_id, created_at desc);

create table if not exists public.hid_audit_events (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_profile_id uuid references public.hid_user_profiles(id) on delete set null,
  actor_role public.hid_app_role,
  patient_id uuid references public.hid_patients(id) on delete set null,
  organization_id uuid references public.hid_organizations(id) on delete set null,
  resource_type text not null,
  resource_id uuid,
  action text not null,
  reason text,
  ip_address inet,
  user_agent text,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_hid_audit_events_patient_created on public.hid_audit_events(patient_id, created_at desc);
create index if not exists idx_hid_audit_events_actor_created on public.hid_audit_events(actor_user_id, created_at desc);

create table if not exists public.hid_password_failed_verification_attempts (
  user_id uuid primary key,
  last_failed_at timestamptz not null default now()
);

create table if not exists public.hid_mfa_failed_verification_attempts (
  user_id uuid not null,
  factor_id uuid not null,
  last_failed_at timestamptz not null default now(),
  primary key (user_id, factor_id)
);

create or replace function public.hid_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.hid_normalize_phone(value text)
returns text
language sql
immutable
as $$
  select case
    when value is null then null
    else regexp_replace(value, '[^0-9+]', '', 'g')
  end
$$;

create or replace function public.hid_current_user_profile_id()
returns uuid
language sql
stable
as $$
  select id
  from public.hid_user_profiles
  where auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.hid_current_patient_id()
returns uuid
language sql
stable
as $$
  select id
  from public.hid_patients
  where auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.hid_current_staff_account_id()
returns uuid
language sql
stable
as $$
  select id
  from public.hid_staff_accounts
  where auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.hid_current_app_role()
returns public.hid_app_role
language sql
stable
as $$
  select app_role
  from public.hid_user_profiles
  where auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.hid_is_platform_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.hid_current_app_role() = 'platform_admin', false)
$$;

create or replace function public.hid_is_org_admin(target_organization_id uuid)
returns boolean
language sql
stable
as $$
  select
    public.hid_is_platform_admin()
    or exists (
      select 1
      from public.hid_staff_memberships membership
      join public.hid_staff_accounts staff on staff.id = membership.staff_account_id
      where staff.auth_user_id = auth.uid()
        and membership.organization_id = target_organization_id
        and membership.active = true
        and membership.app_role = 'org_admin'
    )
$$;

create or replace function public.hid_has_active_grant(target_patient_id uuid, required_scope public.hid_access_scope default 'read_records')
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.hid_access_grants grant_row
    join public.hid_staff_accounts staff on staff.id = grant_row.staff_account_id
    where staff.auth_user_id = auth.uid()
      and grant_row.patient_id = target_patient_id
      and grant_row.status = 'active'
      and grant_row.starts_at <= now()
      and grant_row.expires_at > now()
      and (
        grant_row.scope = required_scope
        or grant_row.scope = 'break_glass'
        or (required_scope = 'read_records' and grant_row.scope = 'write_records')
      )
  )
$$;

create or replace function public.hid_generate_hid_code()
returns text
language plpgsql
as $$
declare
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i integer;
begin
  for i in 1..20 loop
    candidate := 'HID-';
    candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::integer, 1);
    candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::integer, 1);
    candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::integer, 1);
    candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::integer, 1);
    candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::integer, 1);
    candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::integer, 1);

    if not exists (select 1 from public.hid_patients where hid_code = candidate) then
      return candidate;
    end if;
  end loop;

  raise exception 'Could not generate unique HID code';
end;
$$;

create or replace function public.hid_refresh_patient_identifiers(target_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_row public.hid_patients;
begin
  select *
  into patient_row
  from public.hid_patients
  where id = target_patient_id;

  if not found then
    return;
  end if;

  delete from public.hid_patient_identifiers
  where patient_id = target_patient_id;

  insert into public.hid_patient_identifiers (patient_id, identifier_type, raw_value, normalized_value, verified)
  values (target_patient_id, 'hid_code', patient_row.hid_code, upper(patient_row.hid_code), true)
  on conflict do nothing;

  if patient_row.phone_e164 is not null then
    insert into public.hid_patient_identifiers (patient_id, identifier_type, raw_value, normalized_value, verified)
    values (target_patient_id, 'phone', patient_row.phone_e164, public.hid_normalize_phone(patient_row.phone_e164), true)
    on conflict do nothing;
  end if;

  if patient_row.email is not null then
    insert into public.hid_patient_identifiers (patient_id, identifier_type, raw_value, normalized_value, verified)
    values (target_patient_id, 'email', patient_row.email::text, lower(patient_row.email::text), true)
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.hid_patient_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.hid_refresh_patient_identifiers(new.id);
  return new;
end;
$$;

create or replace function public.hid_resolve_patient_identifier(identifier text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select patient_id
  from public.hid_patient_identifiers
  where normalized_value = case
    when identifier ilike 'hid-%' then upper(trim(identifier))
    when position('@' in identifier) > 0 then lower(trim(identifier))
    else public.hid_normalize_phone(identifier)
  end
  limit 1
$$;

create or replace function public.hid_log_audit_event(
  p_resource_type text,
  p_action text,
  p_resource_id uuid default null,
  p_patient_id uuid default null,
  p_organization_id uuid default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := public.hid_current_user_profile_id();
  v_event_id uuid := gen_random_uuid();
begin
  insert into public.hid_audit_events (
    event_id,
    actor_user_id,
    actor_profile_id,
    actor_role,
    patient_id,
    organization_id,
    resource_type,
    resource_id,
    action,
    reason,
    metadata
  )
  values (
    v_event_id,
    auth.uid(),
    v_profile_id,
    public.hid_current_app_role(),
    p_patient_id,
    p_organization_id,
    p_resource_type,
    p_resource_id,
    p_action,
    p_reason,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return v_event_id;
end;
$$;

create or replace function public.hid_create_notification(
  p_user_profile_id uuid,
  p_patient_id uuid,
  p_title text,
  p_message text,
  p_type text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification_id uuid := gen_random_uuid();
begin
  insert into public.hid_notifications (id, user_profile_id, patient_id, title, message, type)
  values (v_notification_id, p_user_profile_id, p_patient_id, p_title, p_message, p_type);
  return v_notification_id;
end;
$$;

create or replace function public.hid_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := coalesce(new.raw_user_meta_data ->> 'requested_role', 'patient');
  resolved_role public.hid_app_role := 'patient';
begin
  if requested_role = 'clinician' then
    resolved_role := 'clinician';
  elsif requested_role = 'org_admin' then
    resolved_role := 'org_admin';
  elsif requested_role = 'platform_admin' then
    resolved_role := 'platform_admin';
  end if;

  insert into public.hid_user_profiles (auth_user_id, app_role, display_name, mfa_required)
  values (
    new.id,
    resolved_role,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, new.phone, 'HID User'), '@', 1)),
    resolved_role <> 'patient'
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists hid_on_auth_user_created on auth.users;
create trigger hid_on_auth_user_created
  after insert on auth.users
  for each row execute function public.hid_handle_new_auth_user();

create or replace function public.hid_before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  email_value text := lower(coalesce(event -> 'user' ->> 'email', ''));
  requested_role text := coalesce(event -> 'user' -> 'user_metadata' ->> 'requested_role', 'patient');
  domain_value text := split_part(email_value, '@', 2);
begin
  if requested_role in ('clinician', 'org_admin', 'platform_admin') then
    if email_value = '' then
      return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'Staff accounts must use email sign-up.'));
    end if;

    if not exists (
      select 1
      from public.hid_allowed_staff_domains
      where domain = domain_value
        and active = true
    ) then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Staff sign-up is invite-only.'));
    end if;
  end if;

  return '{}'::jsonb;
end;
$$;

create or replace function public.hid_custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb := event -> 'claims';
  user_profile_row public.hid_user_profiles;
  patient_row public.hid_patients;
  staff_row public.hid_staff_accounts;
  membership_row public.hid_staff_memberships;
begin
  select *
  into user_profile_row
  from public.hid_user_profiles
  where auth_user_id = (event ->> 'user_id')::uuid;

  if user_profile_row.id is null then
    return jsonb_build_object('claims', claims);
  end if;

  select *
  into patient_row
  from public.hid_patients
  where auth_user_id = user_profile_row.auth_user_id;

  select *
  into staff_row
  from public.hid_staff_accounts
  where auth_user_id = user_profile_row.auth_user_id;

  select *
  into membership_row
  from public.hid_staff_memberships
  where staff_account_id = staff_row.id
    and is_primary = true
    and active = true
  limit 1;

  claims := jsonb_set(claims, '{app_metadata,app_role}', to_jsonb(user_profile_row.app_role::text), true);
  claims := jsonb_set(claims, '{app_metadata,user_profile_id}', to_jsonb(user_profile_row.id::text), true);
  claims := jsonb_set(claims, '{app_metadata,mfa_required}', to_jsonb(user_profile_row.mfa_required), true);
  claims := jsonb_set(claims, '{app_metadata,patient_id}', to_jsonb(coalesce(patient_row.id::text, '')), true);
  claims := jsonb_set(claims, '{app_metadata,staff_account_id}', to_jsonb(coalesce(staff_row.id::text, '')), true);
  claims := jsonb_set(claims, '{app_metadata,organization_id}', to_jsonb(coalesce(membership_row.organization_id::text, '')), true);
  claims := jsonb_set(claims, '{app_metadata,facility_id}', to_jsonb(coalesce(membership_row.facility_id::text, '')), true);

  return jsonb_build_object('claims', claims);
end;
$$;

create or replace function public.hid_password_verification_attempt_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  last_failed_at timestamptz;
  profile_active boolean;
  target_user_id uuid := (event ->> 'user_id')::uuid;
begin
  select active into profile_active
  from public.hid_user_profiles
  where auth_user_id = target_user_id;

  if coalesce(profile_active, true) = false then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'This account is inactive.',
      'should_logout_user', true
    );
  end if;

  if (event ->> 'valid')::boolean then
    return jsonb_build_object('decision', 'continue');
  end if;

  select last_failed_at
  into last_failed_at
  from public.hid_password_failed_verification_attempts
  where user_id = target_user_id;

  if last_failed_at is not null and now() - last_failed_at < interval '5 seconds' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 429,
        'message', 'Please wait before trying again.'
      )
    );
  end if;

  insert into public.hid_password_failed_verification_attempts (user_id, last_failed_at)
  values (target_user_id, now())
  on conflict (user_id) do update
    set last_failed_at = excluded.last_failed_at;

  return jsonb_build_object('decision', 'continue');
end;
$$;

create or replace function public.hid_mfa_verification_attempt_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  last_failed_at timestamptz;
  target_user_id uuid := (event ->> 'user_id')::uuid;
  target_factor_id uuid := (event ->> 'factor_id')::uuid;
begin
  if (event ->> 'valid')::boolean then
    return jsonb_build_object('decision', 'continue');
  end if;

  select last_failed_at
  into last_failed_at
  from public.hid_mfa_failed_verification_attempts
  where user_id = target_user_id
    and factor_id = target_factor_id;

  if last_failed_at is not null and now() - last_failed_at < interval '2 seconds' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 429,
        'message', 'Please wait a moment before retrying MFA.'
      )
    );
  end if;

  insert into public.hid_mfa_failed_verification_attempts (user_id, factor_id, last_failed_at)
  values (target_user_id, target_factor_id, now())
  on conflict (user_id, factor_id) do update
    set last_failed_at = excluded.last_failed_at;

  return jsonb_build_object('decision', 'continue');
end;
$$;

create or replace function public.hid_register_patient_profile(
  p_first_name text,
  p_last_name text,
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

create or replace function public.hid_issue_staff_invite(
  p_organization_id uuid,
  p_facility_id uuid,
  p_email text,
  p_membership_role public.hid_staff_role,
  p_app_role public.hid_app_role default 'clinician'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_id uuid;
  inviter_profile_id uuid := public.hid_current_user_profile_id();
begin
  if not public.hid_is_org_admin(p_organization_id) then
    raise exception 'Only org admins may invite staff';
  end if;

  insert into public.hid_staff_invites (
    organization_id,
    facility_id,
    email,
    membership_role,
    app_role,
    invited_by_user_profile_id
  )
  values (
    p_organization_id,
    p_facility_id,
    lower(trim(p_email)),
    p_membership_role,
    p_app_role,
    inviter_profile_id
  )
  returning id into invite_id;

  perform public.hid_log_audit_event(
    'staff_invite',
    'staff_invited',
    invite_id,
    null,
    p_organization_id,
    null,
    jsonb_build_object('email', lower(trim(p_email)))
  );

  return jsonb_build_object('invite_id', invite_id);
end;
$$;

create or replace function public.hid_complete_staff_onboarding(
  p_full_name text,
  p_license_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_id uuid := public.hid_current_user_profile_id();
  auth_email text;
  invite_row public.hid_staff_invites;
  staff_id uuid;
  membership_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select lower(email)
  into auth_email
  from auth.users
  where id = auth.uid();

  if auth_email is null then
    raise exception 'Staff onboarding requires an email account';
  end if;

  select *
  into invite_row
  from public.hid_staff_invites
  where email = auth_email
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  if invite_row.id is null then
    raise exception 'No active staff invite was found for this account';
  end if;

  update public.hid_user_profiles
  set
    app_role = invite_row.app_role,
    display_name = trim(p_full_name),
    mfa_required = true,
    updated_at = now()
  where id = profile_id;

  insert into public.hid_staff_accounts (
    user_profile_id,
    auth_user_id,
    full_name,
    email,
    hospital_name,
    verification_status,
    license_number,
    role
  )
  values (
    profile_id,
    auth.uid(),
    trim(p_full_name),
    auth_email,
    (select name from public.hid_organizations where id = invite_row.organization_id),
    'pending_verification',
    nullif(trim(p_license_number), ''),
    invite_row.membership_role
  )
  on conflict (auth_user_id) do update
    set
      full_name = excluded.full_name,
      hospital_name = excluded.hospital_name,
      license_number = excluded.license_number,
      role = excluded.role,
      updated_at = now()
  returning id into staff_id;

  insert into public.hid_staff_memberships (
    staff_account_id,
    organization_id,
    facility_id,
    membership_role,
    app_role,
    is_primary
  )
  values (
    staff_id,
    invite_row.organization_id,
    invite_row.facility_id,
    invite_row.membership_role,
    invite_row.app_role,
    true
  )
  on conflict (staff_account_id, organization_id, facility_id, membership_role) do update
    set
      active = true,
      is_primary = excluded.is_primary,
      updated_at = now()
  returning id into membership_id;

  update public.hid_staff_invites
  set
    status = 'accepted',
    accepted_at = now(),
    updated_at = now()
  where id = invite_row.id;

  perform public.hid_log_audit_event(
    'staff_account',
    'staff_onboarded',
    staff_id,
    null,
    invite_row.organization_id,
    null,
    jsonb_build_object('membership_id', membership_id)
  );

  return jsonb_build_object(
    'staff_account_id', staff_id,
    'membership_id', membership_id,
    'organization_id', invite_row.organization_id,
    'facility_id', invite_row.facility_id
  );
end;
$$;

create or replace function public.hid_create_access_request(
  p_patient_identifier text,
  p_scope public.hid_access_scope,
  p_reason text,
  p_duration_minutes integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_id uuid := public.hid_resolve_patient_identifier(p_patient_identifier);
  staff_id uuid := public.hid_current_staff_account_id();
  membership_row public.hid_staff_memberships;
  request_id uuid;
  patient_profile_id uuid;
begin
  if patient_id is null then
    raise exception 'Patient was not found';
  end if;

  if staff_id is null then
    raise exception 'Only staff can request access';
  end if;

  select *
  into membership_row
  from public.hid_staff_memberships
  where staff_account_id = staff_id
    and is_primary = true
    and active = true
  limit 1;

  if membership_row.id is null then
    raise exception 'No active staff membership found';
  end if;

  insert into public.hid_access_requests (
    patient_id,
    requester_staff_account_id,
    requester_membership_id,
    scope,
    reason,
    requested_duration_minutes
  )
  values (
    patient_id,
    staff_id,
    membership_row.id,
    p_scope,
    trim(p_reason),
    greatest(5, least(coalesce(p_duration_minutes, 60), 1440))
  )
  returning id into request_id;

  select user_profile_id
  into patient_profile_id
  from public.hid_patients
  where id = patient_id;

  perform public.hid_create_notification(
    patient_profile_id,
    patient_id,
    'Access request received',
    'A clinician requested access to your records.',
    'access_request'
  );

  perform public.hid_log_audit_event(
    'access_request',
    'access_requested',
    request_id,
    patient_id,
    membership_row.organization_id,
    trim(p_reason),
    jsonb_build_object('scope', p_scope, 'duration_minutes', p_duration_minutes)
  );

  return jsonb_build_object('request_id', request_id, 'patient_id', patient_id);
end;
$$;

create or replace function public.hid_approve_access_request(
  p_request_id uuid,
  p_duration_minutes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.hid_access_requests;
  grant_id uuid;
  requester_profile_id uuid;
  duration_value integer;
begin
  select *
  into request_row
  from public.hid_access_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Access request was not found';
  end if;

  if request_row.patient_id <> public.hid_current_patient_id() then
    raise exception 'Only the patient can approve this request';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'Only pending requests can be approved';
  end if;

  duration_value := greatest(5, least(coalesce(p_duration_minutes, request_row.requested_duration_minutes), 1440));

  update public.hid_access_requests
  set
    status = 'approved',
    approved_by_patient_id = public.hid_current_patient_id(),
    approved_at = now(),
    updated_at = now()
  where id = request_row.id;

  insert into public.hid_access_grants (
    request_id,
    patient_id,
    staff_account_id,
    membership_id,
    scope,
    granted_by_patient_id,
    reason,
    starts_at,
    expires_at
  )
  values (
    request_row.id,
    request_row.patient_id,
    request_row.requester_staff_account_id,
    request_row.requester_membership_id,
    request_row.scope,
    public.hid_current_patient_id(),
    request_row.reason,
    now(),
    now() + make_interval(mins => duration_value)
  )
  returning id into grant_id;

  select user_profile_id
  into requester_profile_id
  from public.hid_staff_accounts
  where id = request_row.requester_staff_account_id;

  perform public.hid_create_notification(
    requester_profile_id,
    request_row.patient_id,
    'Access approved',
    'Your access request has been approved.',
    'access_granted'
  );

  perform public.hid_log_audit_event(
    'access_grant',
    'access_approved',
    grant_id,
    request_row.patient_id,
    null,
    request_row.reason,
    jsonb_build_object('request_id', request_row.id)
  );

  return jsonb_build_object('grant_id', grant_id, 'request_id', request_row.id);
end;
$$;

create or replace function public.hid_revoke_access_grant(
  p_grant_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_row public.hid_access_grants;
  requester_profile_id uuid;
begin
  select *
  into grant_row
  from public.hid_access_grants
  where id = p_grant_id
  for update;

  if grant_row.id is null then
    raise exception 'Access grant was not found';
  end if;

  if grant_row.patient_id <> public.hid_current_patient_id() and not public.hid_is_platform_admin() then
    raise exception 'Only the patient or a platform admin can revoke this grant';
  end if;

  update public.hid_access_grants
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by_user_profile_id = public.hid_current_user_profile_id(),
    revoked_reason = nullif(trim(p_reason), ''),
    updated_at = now()
  where id = grant_row.id;

  if grant_row.request_id is not null then
    update public.hid_access_requests
    set
      status = 'revoked',
      updated_at = now()
    where id = grant_row.request_id;
  end if;

  select user_profile_id
  into requester_profile_id
  from public.hid_staff_accounts
  where id = grant_row.staff_account_id;

  perform public.hid_create_notification(
    requester_profile_id,
    grant_row.patient_id,
    'Access revoked',
    'A patient revoked your access to their records.',
    'access_rejected'
  );

  perform public.hid_log_audit_event(
    'access_grant',
    'access_revoked',
    grant_row.id,
    grant_row.patient_id,
    null,
    p_reason,
    jsonb_build_object('request_id', grant_row.request_id)
  );

  return jsonb_build_object('grant_id', grant_row.id, 'status', 'revoked');
end;
$$;

create or replace function public.hid_break_glass_access(
  p_patient_identifier text,
  p_reason text,
  p_duration_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_id uuid := public.hid_resolve_patient_identifier(p_patient_identifier);
  staff_id uuid := public.hid_current_staff_account_id();
  membership_row public.hid_staff_memberships;
  request_id uuid;
  grant_id uuid;
  patient_profile_id uuid;
  duration_value integer := greatest(5, least(coalesce(p_duration_minutes, 30), 240));
begin
  if patient_id is null then
    raise exception 'Patient was not found';
  end if;

  if staff_id is null then
    raise exception 'Only staff can use break-glass access';
  end if;

  select *
  into membership_row
  from public.hid_staff_memberships
  where staff_account_id = staff_id
    and is_primary = true
    and active = true
  limit 1;

  if membership_row.id is null then
    raise exception 'No active staff membership found';
  end if;

  insert into public.hid_access_requests (
    patient_id,
    requester_staff_account_id,
    requester_membership_id,
    scope,
    reason,
    status,
    requested_duration_minutes,
    break_glass,
    approved_at
  )
  values (
    patient_id,
    staff_id,
    membership_row.id,
    'break_glass',
    trim(p_reason),
    'approved',
    duration_value,
    true,
    now()
  )
  returning id into request_id;

  insert into public.hid_access_grants (
    request_id,
    patient_id,
    staff_account_id,
    membership_id,
    scope,
    status,
    reason,
    starts_at,
    expires_at
  )
  values (
    request_id,
    patient_id,
    staff_id,
    membership_row.id,
    'break_glass',
    'active',
    trim(p_reason),
    now(),
    now() + make_interval(mins => duration_value)
  )
  returning id into grant_id;

  select user_profile_id
  into patient_profile_id
  from public.hid_patients
  where id = patient_id;

  perform public.hid_create_notification(
    patient_profile_id,
    patient_id,
    'Emergency access activated',
    'Emergency access was activated on your record. Review your access history for details.',
    'access_granted'
  );

  perform public.hid_log_audit_event(
    'access_grant',
    'break_glass_activated',
    grant_id,
    patient_id,
    membership_row.organization_id,
    trim(p_reason),
    jsonb_build_object('request_id', request_id, 'duration_minutes', duration_value)
  );

  return jsonb_build_object('request_id', request_id, 'grant_id', grant_id);
end;
$$;

create or replace function public.hid_create_medical_record(
  p_patient_identifier text,
  p_title text,
  p_category text,
  p_record text,
  p_notes text default null
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
    created_by_user_profile_id,
    created_by_staff_account_id
  )
  values (
    patient_id,
    coalesce(nullif(trim(p_title), ''), 'Medical Record'),
    coalesce(nullif(trim(p_category), ''), 'other'),
    profile_id,
    staff_id
  )
  returning id into record_id;

  insert into public.hid_medical_record_versions (
    record_id,
    version_no,
    record,
    notes,
    created_by_user_profile_id,
    created_by_staff_account_id
  )
  values (
    record_id,
    1,
    trim(p_record),
    nullif(trim(p_notes), ''),
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

create or replace function public.hid_append_medical_record_version(
  p_record_id uuid,
  p_record text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  record_row public.hid_medical_records;
  version_id uuid;
  next_version integer;
  profile_id uuid := public.hid_current_user_profile_id();
  staff_id uuid := public.hid_current_staff_account_id();
begin
  select *
  into record_row
  from public.hid_medical_records
  where id = p_record_id
  for update;

  if record_row.id is null then
    raise exception 'Medical record was not found';
  end if;

  if public.hid_current_patient_id() <> record_row.patient_id and not public.hid_has_active_grant(record_row.patient_id, 'write_records') and not public.hid_is_platform_admin() then
    raise exception 'You do not have permission to update this record';
  end if;

  select coalesce(max(version_no), 0) + 1
  into next_version
  from public.hid_medical_record_versions
  where record_id = p_record_id;

  insert into public.hid_medical_record_versions (
    record_id,
    version_no,
    record,
    notes,
    created_by_user_profile_id,
    created_by_staff_account_id
  )
  values (
    p_record_id,
    next_version,
    trim(p_record),
    nullif(trim(p_notes), ''),
    profile_id,
    staff_id
  )
  returning id into version_id;

  update public.hid_medical_records
  set
    current_version_id = version_id,
    updated_at = now()
  where id = p_record_id;

  perform public.hid_log_audit_event(
    'medical_record',
    'record_version_created',
    p_record_id,
    record_row.patient_id,
    null,
    null,
    jsonb_build_object('version_id', version_id, 'version_no', next_version)
  );

  return jsonb_build_object('record_id', p_record_id, 'version_id', version_id, 'version_no', next_version);
end;
$$;

create or replace function public.hid_authorize_record_upload(p_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  record_row public.hid_medical_records;
begin
  select *
  into record_row
  from public.hid_medical_records
  where id = p_record_id;

  if record_row.id is null then
    raise exception 'Medical record was not found';
  end if;

  if public.hid_current_patient_id() <> record_row.patient_id and not public.hid_has_active_grant(record_row.patient_id, 'write_records') and not public.hid_is_platform_admin() then
    raise exception 'You do not have permission to upload files for this record';
  end if;

  return jsonb_build_object('patient_id', record_row.patient_id, 'record_id', record_row.id);
end;
$$;

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
    jsonb_build_object('record_id', p_record_id, 'storage_path', p_storage_path)
  );

  return jsonb_build_object('file_id', file_id, 'storage_path', p_storage_path);
end;
$$;

create or replace function public.hid_get_my_patient_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_row public.hid_patients;
begin
  select *
  into patient_row
  from public.hid_patients
  where auth_user_id = auth.uid();

  if patient_row.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'patient', to_jsonb(patient_row),
    'identifiers', (
      select coalesce(jsonb_agg(to_jsonb(identifier_row) order by identifier_row.created_at), '[]'::jsonb)
      from public.hid_patient_identifiers identifier_row
      where identifier_row.patient_id = patient_row.id
    ),
    'active_grants', (
      select coalesce(count(*), 0)
      from public.hid_access_grants grant_row
      where grant_row.patient_id = patient_row.id
        and grant_row.status = 'active'
        and grant_row.expires_at > now()
    )
  );
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
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'record', to_jsonb(record_row),
          'current_version', to_jsonb(version_row),
          'files', (
            select coalesce(jsonb_agg(to_jsonb(file_row) order by file_row.created_at), '[]'::jsonb)
            from public.hid_medical_record_files file_row
            where file_row.record_id = record_row.id
          )
        ) order by record_row.created_at desc
      ), '[]'::jsonb)
      from public.hid_medical_records record_row
      left join public.hid_medical_record_versions version_row on version_row.id = record_row.current_version_id
      where record_row.patient_id = target_patient_id
    )
  );
end;
$$;

create or replace function public.hid_list_my_notifications(p_limit integer default 50)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(to_jsonb(notification_row) order by notification_row.created_at desc),
    '[]'::jsonb
  )
  from (
    select *
    from public.hid_notifications
    where user_profile_id = public.hid_current_user_profile_id()
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) notification_row
$$;

create or replace function public.hid_list_my_audit_events(p_limit integer default 50)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(to_jsonb(event_row) order by event_row.created_at desc),
    '[]'::jsonb
  )
  from (
    select *
    from public.hid_audit_events
    where actor_user_id = auth.uid()
       or patient_id = public.hid_current_patient_id()
       or public.hid_is_platform_admin()
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) event_row
$$;

create or replace function public.hid_prevent_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Audit events are append-only.';
end;
$$;

drop trigger if exists hid_no_update_audit_events on public.hid_audit_events;
create trigger hid_no_update_audit_events
  before update or delete on public.hid_audit_events
  for each row execute function public.hid_prevent_audit_event_mutation();

drop trigger if exists hid_patients_refresh_identifiers on public.hid_patients;
create trigger hid_patients_refresh_identifiers
  after insert or update of hid_code, phone_e164, email on public.hid_patients
  for each row execute function public.hid_patient_refresh_trigger();

drop trigger if exists hid_orgs_set_updated_at on public.hid_organizations;
create trigger hid_orgs_set_updated_at before update on public.hid_organizations for each row execute function public.hid_set_updated_at();
drop trigger if exists hid_facilities_set_updated_at on public.hid_facilities;
create trigger hid_facilities_set_updated_at before update on public.hid_facilities for each row execute function public.hid_set_updated_at();
drop trigger if exists hid_user_profiles_set_updated_at on public.hid_user_profiles;
create trigger hid_user_profiles_set_updated_at before update on public.hid_user_profiles for each row execute function public.hid_set_updated_at();
drop trigger if exists hid_patients_set_updated_at on public.hid_patients;
create trigger hid_patients_set_updated_at before update on public.hid_patients for each row execute function public.hid_set_updated_at();
drop trigger if exists hid_staff_accounts_set_updated_at on public.hid_staff_accounts;
create trigger hid_staff_accounts_set_updated_at before update on public.hid_staff_accounts for each row execute function public.hid_set_updated_at();
drop trigger if exists hid_staff_memberships_set_updated_at on public.hid_staff_memberships;
create trigger hid_staff_memberships_set_updated_at before update on public.hid_staff_memberships for each row execute function public.hid_set_updated_at();
drop trigger if exists hid_staff_invites_set_updated_at on public.hid_staff_invites;
create trigger hid_staff_invites_set_updated_at before update on public.hid_staff_invites for each row execute function public.hid_set_updated_at();
drop trigger if exists hid_access_requests_set_updated_at on public.hid_access_requests;
create trigger hid_access_requests_set_updated_at before update on public.hid_access_requests for each row execute function public.hid_set_updated_at();
drop trigger if exists hid_access_grants_set_updated_at on public.hid_access_grants;
create trigger hid_access_grants_set_updated_at before update on public.hid_access_grants for each row execute function public.hid_set_updated_at();
drop trigger if exists hid_medical_records_set_updated_at on public.hid_medical_records;
create trigger hid_medical_records_set_updated_at before update on public.hid_medical_records for each row execute function public.hid_set_updated_at();

alter table public.hid_organizations enable row level security;
alter table public.hid_facilities enable row level security;
alter table public.hid_user_profiles enable row level security;
alter table public.hid_patients enable row level security;
alter table public.hid_patient_identifiers enable row level security;
alter table public.hid_staff_accounts enable row level security;
alter table public.hid_staff_memberships enable row level security;
alter table public.hid_staff_invites enable row level security;
alter table public.hid_access_requests enable row level security;
alter table public.hid_access_grants enable row level security;
alter table public.hid_medical_records enable row level security;
alter table public.hid_medical_record_versions enable row level security;
alter table public.hid_medical_record_files enable row level security;
alter table public.hid_notifications enable row level security;
alter table public.hid_audit_events enable row level security;

drop policy if exists "hid orgs readable by staff" on public.hid_organizations;
create policy "hid orgs readable by staff" on public.hid_organizations for select to authenticated using (
  public.hid_is_platform_admin()
  or exists (
    select 1
    from public.hid_staff_memberships membership
    join public.hid_staff_accounts staff on staff.id = membership.staff_account_id
    where staff.auth_user_id = auth.uid()
      and membership.organization_id = hid_organizations.id
      and membership.active = true
  )
);

drop policy if exists "hid facilities readable by staff" on public.hid_facilities;
create policy "hid facilities readable by staff" on public.hid_facilities for select to authenticated using (
  public.hid_is_platform_admin()
  or public.hid_is_org_admin(organization_id)
  or exists (
    select 1
    from public.hid_staff_memberships membership
    join public.hid_staff_accounts staff on staff.id = membership.staff_account_id
    where staff.auth_user_id = auth.uid()
      and membership.facility_id = hid_facilities.id
      and membership.active = true
  )
);

drop policy if exists "hid user profiles own row" on public.hid_user_profiles;
create policy "hid user profiles own row" on public.hid_user_profiles for select to authenticated using (auth_user_id = auth.uid() or public.hid_is_platform_admin());

drop policy if exists "hid user profiles self update" on public.hid_user_profiles;
create policy "hid user profiles self update" on public.hid_user_profiles for update to authenticated using (auth_user_id = auth.uid() or public.hid_is_platform_admin()) with check (auth_user_id = auth.uid() or public.hid_is_platform_admin());

drop policy if exists "hid patients self or granted select" on public.hid_patients;
create policy "hid patients self or granted select" on public.hid_patients for select to authenticated using (
  auth_user_id = auth.uid()
  or public.hid_has_active_grant(id, 'read_records')
  or public.hid_is_platform_admin()
);

drop policy if exists "hid patients self update" on public.hid_patients;
create policy "hid patients self update" on public.hid_patients for update to authenticated using (auth_user_id = auth.uid() or public.hid_is_platform_admin()) with check (auth_user_id = auth.uid() or public.hid_is_platform_admin());

drop policy if exists "hid patient identifiers own select" on public.hid_patient_identifiers;
create policy "hid patient identifiers own select" on public.hid_patient_identifiers for select to authenticated using (
  exists (
    select 1
    from public.hid_patients patient_row
    where patient_row.id = patient_id
      and (patient_row.auth_user_id = auth.uid() or public.hid_is_platform_admin())
  )
);

drop policy if exists "hid staff accounts self or org admin select" on public.hid_staff_accounts;
create policy "hid staff accounts self or org admin select" on public.hid_staff_accounts for select to authenticated using (
  auth_user_id = auth.uid()
  or public.hid_is_platform_admin()
  or exists (
    select 1
    from public.hid_staff_memberships membership
    where membership.staff_account_id = hid_staff_accounts.id
      and public.hid_is_org_admin(membership.organization_id)
  )
);

drop policy if exists "hid staff accounts self update" on public.hid_staff_accounts;
create policy "hid staff accounts self update" on public.hid_staff_accounts for update to authenticated using (auth_user_id = auth.uid() or public.hid_is_platform_admin()) with check (auth_user_id = auth.uid() or public.hid_is_platform_admin());

drop policy if exists "hid staff memberships self or org admin select" on public.hid_staff_memberships;
create policy "hid staff memberships self or org admin select" on public.hid_staff_memberships for select to authenticated using (
  exists (
    select 1
    from public.hid_staff_accounts staff
    where staff.id = staff_account_id
      and (staff.auth_user_id = auth.uid() or public.hid_is_org_admin(organization_id) or public.hid_is_platform_admin())
  )
);

drop policy if exists "hid staff invites org admin select" on public.hid_staff_invites;
create policy "hid staff invites org admin select" on public.hid_staff_invites for select to authenticated using (public.hid_is_org_admin(organization_id) or public.hid_is_platform_admin());

drop policy if exists "hid access requests select parties" on public.hid_access_requests;
create policy "hid access requests select parties" on public.hid_access_requests for select to authenticated using (
  patient_id = public.hid_current_patient_id()
  or requester_staff_account_id = public.hid_current_staff_account_id()
  or public.hid_is_org_admin((select organization_id from public.hid_staff_memberships where id = requester_membership_id))
  or public.hid_is_platform_admin()
);

drop policy if exists "hid access grants select parties" on public.hid_access_grants;
create policy "hid access grants select parties" on public.hid_access_grants for select to authenticated using (
  patient_id = public.hid_current_patient_id()
  or staff_account_id = public.hid_current_staff_account_id()
  or public.hid_is_org_admin((select organization_id from public.hid_staff_memberships where id = membership_id))
  or public.hid_is_platform_admin()
);

drop policy if exists "hid records self or granted select" on public.hid_medical_records;
create policy "hid records self or granted select" on public.hid_medical_records for select to authenticated using (
  patient_id = public.hid_current_patient_id()
  or public.hid_has_active_grant(patient_id, 'read_records')
  or public.hid_is_platform_admin()
);

drop policy if exists "hid records create with active grant" on public.hid_medical_records;
create policy "hid records create with active grant" on public.hid_medical_records for insert to authenticated with check (
  patient_id = public.hid_current_patient_id()
  or public.hid_has_active_grant(patient_id, 'write_records')
  or public.hid_is_platform_admin()
);

drop policy if exists "hid record versions self or granted select" on public.hid_medical_record_versions;
create policy "hid record versions self or granted select" on public.hid_medical_record_versions for select to authenticated using (
  exists (
    select 1
    from public.hid_medical_records record_row
    where record_row.id = record_id
      and (
        record_row.patient_id = public.hid_current_patient_id()
        or public.hid_has_active_grant(record_row.patient_id, 'read_records')
        or public.hid_is_platform_admin()
      )
  )
);

drop policy if exists "hid record files self or granted select" on public.hid_medical_record_files;
create policy "hid record files self or granted select" on public.hid_medical_record_files for select to authenticated using (
  patient_id = public.hid_current_patient_id()
  or public.hid_has_active_grant(patient_id, 'read_records')
  or public.hid_is_platform_admin()
);

drop policy if exists "hid notifications own row" on public.hid_notifications;
create policy "hid notifications own row" on public.hid_notifications for select to authenticated using (user_profile_id = public.hid_current_user_profile_id() or public.hid_is_platform_admin());

drop policy if exists "hid notifications mark own read" on public.hid_notifications;
create policy "hid notifications mark own read" on public.hid_notifications for update to authenticated using (user_profile_id = public.hid_current_user_profile_id() or public.hid_is_platform_admin()) with check (user_profile_id = public.hid_current_user_profile_id() or public.hid_is_platform_admin());

drop policy if exists "hid audit events actor or patient select" on public.hid_audit_events;
create policy "hid audit events actor or patient select" on public.hid_audit_events for select to authenticated using (
  actor_user_id = auth.uid()
  or patient_id = public.hid_current_patient_id()
  or public.hid_is_platform_admin()
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'medical-record-files',
  'medical-record-files',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'text/plain']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hid_before_user_created_hook to supabase_auth_admin;
grant execute on function public.hid_custom_access_token_hook to supabase_auth_admin;
grant execute on function public.hid_password_verification_attempt_hook to supabase_auth_admin;
grant execute on function public.hid_mfa_verification_attempt_hook to supabase_auth_admin;
grant all on table public.hid_password_failed_verification_attempts to supabase_auth_admin;
grant all on table public.hid_mfa_failed_verification_attempts to supabase_auth_admin;

revoke all on function public.hid_before_user_created_hook from authenticated, anon, public;
revoke all on function public.hid_custom_access_token_hook from authenticated, anon, public;
revoke all on function public.hid_password_verification_attempt_hook from authenticated, anon, public;
revoke all on function public.hid_mfa_verification_attempt_hook from authenticated, anon, public;
revoke all on table public.hid_password_failed_verification_attempts from authenticated, anon, public;
revoke all on table public.hid_mfa_failed_verification_attempts from authenticated, anon, public;

notify pgrst, 'reload schema';

commit;
