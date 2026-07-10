create or replace function public.hid_admin_auth_users_created_between(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  auth_user_id uuid,
  email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  select
    users.id as auth_user_id,
    users.email::text as email,
    users.email_confirmed_at,
    users.last_sign_in_at,
    users.created_at
  from auth.users users
  where users.created_at >= p_start
    and users.created_at < p_end
  order by users.created_at desc, users.id desc
$$;

revoke all on function public.hid_admin_auth_users_created_between(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.hid_admin_auth_users_created_between(timestamptz, timestamptz) to service_role;
