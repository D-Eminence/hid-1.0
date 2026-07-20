begin;

do $$
declare
  primary_auth_user_id uuid;
begin
  select id
  into primary_auth_user_id
  from auth.users
  where lower(email) = 'eminence742@gmail.com'
  limit 1;

  if primary_auth_user_id is not null then
    insert into public.hid_user_profiles (
      auth_user_id,
      app_role,
      display_name,
      active,
      mfa_required
    )
    select
      users.id,
      'platform_admin'::public.hid_app_role,
      coalesce(nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''), split_part(users.email, '@', 1)),
      true,
      true
    from auth.users users
    where users.id = primary_auth_user_id
    on conflict (auth_user_id) do update
    set
      app_role = 'platform_admin',
      active = true,
      mfa_required = true,
      deleted_at = null,
      deleted_reason = null,
      restored_at = case when public.hid_user_profiles.deleted_at is not null then now() else public.hid_user_profiles.restored_at end;

    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object(
        'app_role', 'platform_admin',
        'admin_created_platform_admin', true
      )
    where id = primary_auth_user_id;
  end if;
end;
$$;

commit;
