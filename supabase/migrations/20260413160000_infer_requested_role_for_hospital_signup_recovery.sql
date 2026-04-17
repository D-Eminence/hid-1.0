begin;

create or replace function public.hid_complete_staff_onboarding(
  p_full_name text,
  p_license_number text default null,
  p_phone_e164 text default null,
  p_hospital_name text default null,
  p_state text default null,
  p_country text default null,
  p_onboarding_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_id uuid := public.hid_current_user_profile_id();
  auth_email text;
  auth_metadata jsonb := '{}'::jsonb;
  pending_onboarding jsonb := '{}'::jsonb;
  requested_role text := 'patient';
  onboarding_type text := 'staff_invite';
  invite_row public.hid_staff_invites;
  v_staff_id uuid;
  v_membership_id uuid;
  v_organization_id uuid;
  v_facility_id uuid;
  hospital_name_value text;
  state_value text;
  country_value text;
  phone_value text;
  resolved_full_name text;
  app_role_value public.hid_app_role;
  membership_role_value public.hid_staff_role;
  verification_status_value text;
  base_slug text;
  slug_candidate text;
  slug_suffix integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select lower(email), raw_user_meta_data
  into auth_email, auth_metadata
  from auth.users
  where id = auth.uid();

  if auth_email is null then
    raise exception 'Staff onboarding requires an email account';
  end if;

  pending_onboarding := coalesce(auth_metadata -> 'pending_staff_onboarding', '{}'::jsonb);
  onboarding_type := coalesce(
    nullif(trim(p_onboarding_type), ''),
    nullif(trim(pending_onboarding ->> 'onboardingType'), ''),
    'staff_invite'
  );
  requested_role := coalesce(
    nullif(trim(auth_metadata ->> 'requested_role'), ''),
    case when onboarding_type = 'hospital_signup' then 'org_admin' else null end,
    'patient'
  );
  phone_value := coalesce(
    public.hid_normalize_phone(p_phone_e164),
    public.hid_normalize_phone(pending_onboarding ->> 'phone')
  );

  select *
  into invite_row
  from public.hid_staff_invites
  where email = auth_email
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  if invite_row.id is not null then
    v_organization_id := invite_row.organization_id;
    v_facility_id := invite_row.facility_id;
    app_role_value := invite_row.app_role;
    membership_role_value := invite_row.membership_role;
    verification_status_value := 'pending_verification';

    select name
    into hospital_name_value
    from public.hid_organizations
    where id = invite_row.organization_id;
  else
    if requested_role <> 'org_admin' or onboarding_type <> 'hospital_signup' then
      raise exception 'No active staff invite was found for this account';
    end if;

    hospital_name_value := coalesce(
      nullif(trim(p_hospital_name), ''),
      nullif(trim(pending_onboarding ->> 'hospitalName'), '')
    );
    state_value := coalesce(
      nullif(trim(p_state), ''),
      nullif(trim(pending_onboarding ->> 'state'), '')
    );
    country_value := coalesce(
      nullif(trim(p_country), ''),
      nullif(trim(pending_onboarding ->> 'country'), '')
    );

    if hospital_name_value is null or state_value is null or country_value is null then
      raise exception 'Hospital name, state, and country are required';
    end if;

    select id
    into v_organization_id
    from public.hid_organizations
    where lower(name) = lower(hospital_name_value)
      and lower(state) = lower(state_value)
      and lower(country) = lower(country_value)
    limit 1;

    if v_organization_id is not null then
      raise exception 'An account for this hospital already exists. Sign in or contact support.';
    end if;

    base_slug := trim(both '-' from regexp_replace(lower(hospital_name_value), '[^a-z0-9]+', '-', 'g'));
    if base_slug = '' then
      base_slug := 'hospital';
    end if;

    slug_candidate := base_slug;
    while exists (
      select 1
      from public.hid_organizations organization_row
      where organization_row.slug = slug_candidate
    ) loop
      slug_suffix := slug_suffix + 1;
      slug_candidate := left(base_slug, greatest(1, 63 - length(slug_suffix::text) - 1)) || '-' || slug_suffix::text;
    end loop;

    insert into public.hid_organizations (name, slug, state, country)
    values (hospital_name_value, slug_candidate, state_value, country_value)
    returning id into v_organization_id;

    insert into public.hid_facilities (organization_id, name, code)
    values (v_organization_id, hospital_name_value, upper(substring(md5(v_organization_id::text) from 1 for 10)))
    returning id into v_facility_id;

    app_role_value := 'org_admin';
    membership_role_value := 'admin';
    verification_status_value := 'verified';
  end if;

  resolved_full_name := trim(
    coalesce(
      nullif(trim(p_full_name), ''),
      nullif(trim(pending_onboarding ->> 'fullName'), ''),
      concat(hospital_name_value, ' Admin')
    )
  );

  update public.hid_user_profiles
  set
    app_role = app_role_value,
    display_name = resolved_full_name,
    mfa_required = true,
    updated_at = now()
  where id = profile_id;

  insert into public.hid_staff_accounts (
    user_profile_id,
    auth_user_id,
    full_name,
    email,
    phone_e164,
    hospital_name,
    verification_status,
    license_number,
    role
  )
  values (
    profile_id,
    auth.uid(),
    resolved_full_name,
    auth_email,
    phone_value,
    hospital_name_value,
    verification_status_value,
    nullif(trim(p_license_number), ''),
    membership_role_value
  )
  on conflict (auth_user_id) do update
    set
      full_name = excluded.full_name,
      phone_e164 = excluded.phone_e164,
      hospital_name = excluded.hospital_name,
      verification_status = excluded.verification_status,
      license_number = excluded.license_number,
      role = excluded.role,
      updated_at = now()
  returning id into v_staff_id;

  insert into public.hid_staff_memberships (
    staff_account_id,
    organization_id,
    facility_id,
    membership_role,
    app_role,
    is_primary
  )
  values (
    v_staff_id,
    v_organization_id,
    v_facility_id,
    membership_role_value,
    app_role_value,
    true
  )
  on conflict (staff_account_id, organization_id, facility_id, membership_role) do update
    set
      active = true,
      is_primary = excluded.is_primary,
      updated_at = now()
  returning id into v_membership_id;

  if invite_row.id is not null then
    update public.hid_staff_invites
    set
      status = 'accepted',
      accepted_at = now(),
      updated_at = now()
    where id = invite_row.id;
  else
    perform public.hid_log_audit_event(
      'organization',
      'organization_registered',
      v_organization_id,
      null,
      v_organization_id,
      null,
      jsonb_build_object(
        'hospital_name', hospital_name_value,
        'state', state_value,
        'country', country_value,
        'facility_id', v_facility_id
      )
    );
  end if;

  perform public.hid_log_audit_event(
    'staff_account',
    case when invite_row.id is null then 'hospital_signup_completed' else 'staff_onboarding_completed' end,
    v_staff_id,
    null,
    v_organization_id,
    null,
    jsonb_build_object(
      'app_role', app_role_value::text,
      'membership_role', membership_role_value::text,
      'facility_id', v_facility_id
    )
  );

  return jsonb_build_object(
    'staff_account_id', v_staff_id,
    'membership_id', v_membership_id,
    'organization_id', v_organization_id,
    'facility_id', v_facility_id
  );
end;
$$;

grant execute on function public.hid_complete_staff_onboarding(text, text, text, text, text, text, text) to authenticated;

commit;
