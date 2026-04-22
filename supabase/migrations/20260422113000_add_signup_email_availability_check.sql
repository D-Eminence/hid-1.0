create or replace function public.hid_auth_email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from auth.users
    where lower(email) = lower(trim(coalesce(p_email, '')))
  );
$$;

revoke all on function public.hid_auth_email_exists(text) from public;
grant execute on function public.hid_auth_email_exists(text) to service_role;
