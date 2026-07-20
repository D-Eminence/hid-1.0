begin;

drop function if exists public.hid_list_platform_admin_accounts();

create function public.hid_list_platform_admin_accounts()
returns table (
  profile_id uuid,
  auth_user_id uuid,
  display_name text,
  email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  active boolean,
  deleted_at timestamptz,
  mfa_required boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  select
    profiles.id as profile_id,
    profiles.auth_user_id,
    profiles.display_name,
    auth_users.email::text as email,
    auth_users.email_confirmed_at,
    auth_users.last_sign_in_at,
    profiles.active,
    profiles.deleted_at,
    profiles.mfa_required,
    profiles.created_at,
    profiles.updated_at
  from public.hid_user_profiles profiles
  left join auth.users auth_users on auth_users.id = profiles.auth_user_id
  where profiles.app_role = 'platform_admin'
  order by profiles.created_at asc;
$$;

revoke all on function public.hid_list_platform_admin_accounts() from public, anon, authenticated;
grant execute on function public.hid_list_platform_admin_accounts() to service_role;

commit;
