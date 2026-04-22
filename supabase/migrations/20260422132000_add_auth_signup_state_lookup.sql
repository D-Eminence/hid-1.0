create or replace function public.hid_auth_email_signup_state(p_email text)
returns table (
  auth_user_id uuid,
  email_confirmed boolean,
  phone_confirmed boolean,
  has_profile boolean
)
language sql
security definer
set search_path = ''
as $$
  select
    users.id as auth_user_id,
    users.email_confirmed_at is not null as email_confirmed,
    users.phone_confirmed_at is not null as phone_confirmed,
    exists(
      select 1
      from public.hid_user_profiles profiles
      where profiles.auth_user_id = users.id
    ) as has_profile
  from auth.users as users
  where lower(users.email) = lower(trim(coalesce(p_email, '')))
  order by users.created_at desc
  limit 1;
$$;

revoke all on function public.hid_auth_email_signup_state(text) from public;
grant execute on function public.hid_auth_email_signup_state(text) to service_role;
