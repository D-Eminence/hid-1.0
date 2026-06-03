begin;

alter table public.hid_platform_controls
  add column if not exists outreach_signup_enabled boolean not null default true,
  add column if not exists outreach_portal_enabled boolean not null default true;

create table if not exists public.hid_outreach_role_policies (
  role text primary key check (role in ('enumerator', 'health_worker', 'admin')),
  can_open_workspace boolean not null default true,
  can_create_encounters boolean not null default true,
  can_manage_invites boolean not null default false,
  can_sync_data boolean not null default true,
  can_view_campaign_data boolean not null default true,
  updated_by_user_profile_id uuid references public.hid_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.hid_outreach_role_policies (
  role,
  can_open_workspace,
  can_create_encounters,
  can_manage_invites,
  can_sync_data,
  can_view_campaign_data
)
values
  ('enumerator', true, true, false, true, true),
  ('health_worker', true, true, false, true, true),
  ('admin', true, true, true, true, true)
on conflict (role) do nothing;

drop trigger if exists hid_outreach_role_policies_set_updated_at on public.hid_outreach_role_policies;
create trigger hid_outreach_role_policies_set_updated_at
  before update on public.hid_outreach_role_policies
  for each row execute function public.hid_set_updated_at();

alter table public.hid_outreach_role_policies enable row level security;

drop policy if exists "hid outreach role policies platform admin read" on public.hid_outreach_role_policies;
create policy "hid outreach role policies platform admin read"
  on public.hid_outreach_role_policies
  for select
  to authenticated
  using (public.hid_is_platform_admin());

drop policy if exists "hid outreach role policies platform admin update" on public.hid_outreach_role_policies;
create policy "hid outreach role policies platform admin update"
  on public.hid_outreach_role_policies
  for update
  to authenticated
  using (public.hid_is_platform_admin())
  with check (public.hid_is_platform_admin());

commit;
