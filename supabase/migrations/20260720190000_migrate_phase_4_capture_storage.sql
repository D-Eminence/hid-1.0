begin;

do $$ begin
  create type public.hid_migration_capture_status as enum ('open','syncing','completed','abandoned');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.hid_migration_asset_status as enum ('pending_upload','uploaded','quarantined','accepted','rejected');
exception when duplicate_object then null; end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'migration-source-files', 'migration-source-files', false, 52428800,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create table public.hid_migration_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hid_organizations(id),
  facility_id uuid not null references public.hid_facilities(id),
  migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
  migration_batch_id uuid references public.hid_migration_batches(id) on delete set null,
  operator_staff_account_id uuid not null references public.hid_staff_accounts(id),
  device_id text,
  client_session_id text not null,
  status public.hid_migration_capture_status not null default 'open',
  last_heartbeat_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_staff_account_id, client_session_id)
);

create table public.hid_migration_source_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hid_organizations(id),
  facility_id uuid not null references public.hid_facilities(id),
  migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
  migration_batch_id uuid references public.hid_migration_batches(id) on delete set null,
  scan_session_id uuid not null references public.hid_migration_scan_sessions(id) on delete restrict,
  folder_reference text not null,
  source_system text not null default 'physical_archive',
  status text not null default 'capturing' check(status in ('capturing','uploaded','needs_rescan','cancelled')),
  created_by_staff_account_id uuid not null references public.hid_staff_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(migration_project_id, source_system, folder_reference)
);

create table public.hid_migration_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hid_organizations(id),
  facility_id uuid not null references public.hid_facilities(id),
  migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
  source_folder_id uuid not null references public.hid_migration_source_folders(id) on delete cascade,
  document_reference text not null,
  title text,
  status text not null default 'capturing' check(status in ('capturing','uploaded','needs_rescan','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_folder_id, document_reference)
);

create table public.hid_migration_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hid_organizations(id),
  facility_id uuid not null references public.hid_facilities(id),
  migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
  source_folder_id uuid not null references public.hid_migration_source_folders(id) on delete cascade,
  source_document_id uuid not null references public.hid_migration_documents(id) on delete cascade,
  page_number integer not null check(page_number > 0),
  rotation_degrees smallint not null default 0 check(rotation_degrees in (0,90,180,270)),
  created_at timestamptz not null default now(),
  unique(source_document_id, page_number)
);

create table public.hid_migration_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hid_organizations(id),
  facility_id uuid not null references public.hid_facilities(id),
  migration_project_id uuid not null references public.hid_migration_projects(id) on delete cascade,
  source_folder_id uuid not null references public.hid_migration_source_folders(id) on delete cascade,
  source_document_id uuid not null references public.hid_migration_documents(id) on delete cascade,
  page_id uuid not null references public.hid_migration_pages(id) on delete cascade,
  parent_asset_id uuid references public.hid_migration_assets(id) on delete restrict,
  asset_kind text not null check(asset_kind in ('original','derived')),
  storage_bucket text not null default 'migration-source-files',
  storage_path text not null unique,
  original_file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check(size_bytes > 0 and size_bytes <= 52428800),
  sha256_hex text not null check(sha256_hex ~ '^[0-9a-f]{64}$'),
  status public.hid_migration_asset_status not null default 'pending_upload',
  uploaded_by_staff_account_id uuid not null references public.hid_staff_accounts(id),
  uploaded_at timestamptz,
  created_at timestamptz not null default now()
);

create index on public.hid_migration_scan_sessions(migration_project_id, status, created_at desc);
create index on public.hid_migration_source_folders(migration_project_id, status, created_at desc);
create index on public.hid_migration_assets(migration_project_id, sha256_hex);

alter table public.hid_migration_scan_sessions enable row level security;
alter table public.hid_migration_source_folders enable row level security;
alter table public.hid_migration_documents enable row level security;
alter table public.hid_migration_pages enable row level security;
alter table public.hid_migration_assets enable row level security;

create policy "migration scan sessions project read" on public.hid_migration_scan_sessions for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "migration folders project read" on public.hid_migration_source_folders for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "migration documents project read" on public.hid_migration_documents for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "migration pages project read" on public.hid_migration_pages for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));
create policy "migration assets project read" on public.hid_migration_assets for select to authenticated using(public.hid_has_migration_project_access(migration_project_id));

grant select on public.hid_migration_scan_sessions, public.hid_migration_source_folders,
  public.hid_migration_documents, public.hid_migration_pages, public.hid_migration_assets to authenticated;

commit;
