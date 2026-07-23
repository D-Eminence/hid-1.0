-- Supabase auth metadata can expose the OAuth provider through either the
-- provider field or the providers array. Treat both forms as Google OAuth.

create or replace function public.hid_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := coalesce(new.raw_user_meta_data ->> 'requested_role', 'patient');
  provider_name text := lower(coalesce(new.raw_app_meta_data ->> 'provider', new.raw_user_meta_data ->> 'provider', ''));
  is_google_identity boolean := provider_name = 'google'
    or coalesce(new.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
    or coalesce(new.raw_user_meta_data -> 'providers', '[]'::jsonb) ? 'google'
    or lower(coalesce(new.raw_user_meta_data ->> 'iss', '')) like '%accounts.google.com%'
    or nullif(new.raw_user_meta_data ->> 'provider_id', '') is not null;
  resolved_role public.hid_app_role := 'patient';
begin
  if requested_role = 'clinician' then
    resolved_role := 'clinician';
  elsif requested_role = 'org_admin' then
    resolved_role := 'org_admin';
  elsif requested_role = 'platform_admin' then
    resolved_role := 'platform_admin';
  end if;

  if resolved_role = 'patient' and is_google_identity then
    return new;
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

commit;
