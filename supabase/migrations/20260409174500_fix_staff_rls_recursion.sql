begin;

create or replace function public.hid_can_view_staff_account(p_staff_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.hid_user_profiles profile
      where profile.auth_user_id = auth.uid()
        and profile.app_role = 'platform_admin'
    )
    or exists (
      select 1
      from public.hid_staff_accounts self_staff
      where self_staff.id = p_staff_account_id
        and self_staff.auth_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.hid_staff_memberships target_membership
      join public.hid_staff_memberships admin_membership
        on admin_membership.organization_id = target_membership.organization_id
       and admin_membership.active = true
       and admin_membership.app_role = 'org_admin'
      join public.hid_staff_accounts admin_staff
        on admin_staff.id = admin_membership.staff_account_id
      where target_membership.staff_account_id = p_staff_account_id
        and target_membership.active = true
        and admin_staff.auth_user_id = auth.uid()
    )
$$;

create or replace function public.hid_can_view_staff_membership(
  p_staff_account_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.hid_user_profiles profile
      where profile.auth_user_id = auth.uid()
        and profile.app_role = 'platform_admin'
    )
    or exists (
      select 1
      from public.hid_staff_accounts self_staff
      where self_staff.id = p_staff_account_id
        and self_staff.auth_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.hid_staff_memberships admin_membership
      join public.hid_staff_accounts admin_staff
        on admin_staff.id = admin_membership.staff_account_id
      where admin_membership.organization_id = p_organization_id
        and admin_membership.active = true
        and admin_membership.app_role = 'org_admin'
        and admin_staff.auth_user_id = auth.uid()
    )
$$;

grant execute on function public.hid_can_view_staff_account(uuid) to authenticated;
grant execute on function public.hid_can_view_staff_membership(uuid, uuid) to authenticated;

drop policy if exists "hid staff accounts self or org admin select" on public.hid_staff_accounts;
create policy "hid staff accounts self or org admin select" on public.hid_staff_accounts
for select
to authenticated
using (public.hid_can_view_staff_account(id));

drop policy if exists "hid staff memberships self or org admin select" on public.hid_staff_memberships;
create policy "hid staff memberships self or org admin select" on public.hid_staff_memberships
for select
to authenticated
using (public.hid_can_view_staff_membership(staff_account_id, organization_id));

commit;
