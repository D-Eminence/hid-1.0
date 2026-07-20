begin;

do $$ begin
  create type public.hid_ai_provider_kind as enum ('ocr', 'ai', 'multimodal', 'compatible');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.hid_ai_provider_status as enum ('active', 'disabled', 'degraded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.hid_ai_processing_strategy as enum ('ocr_then_ai', 'direct_multimodal');
exception when duplicate_object then null; end $$;

create table if not exists public.hid_ai_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 120),
  provider_type text not null check (provider_type in ('nvidia', 'deepseek', 'anthropic', 'openai', 'google', 'other')),
  provider_kind public.hid_ai_provider_kind not null,
  api_base_url text,
  api_version text,
  organization_reference text,
  project_reference text,
  request_timeout_ms integer not null default 30000 check (request_timeout_ms between 1000 and 300000),
  max_retry_count integer not null default 3 check (max_retry_count between 0 and 20),
  status public.hid_ai_provider_status not null default 'active',
  priority integer not null default 100 check (priority between 1 and 10000),
  api_key_ciphertext text,
  api_key_iv text,
  api_key_masked text,
  api_key_version integer not null default 1,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_code text,
  average_latency_ms numeric check (average_latency_ms is null or average_latency_ms >= 0),
  configuration_version integer not null default 1,
  created_by_user_profile_id uuid references public.hid_user_profiles(id),
  updated_by_user_profile_id uuid references public.hid_user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((api_key_ciphertext is null) = (api_key_iv is null))
);

comment on table public.hid_ai_providers is
  'Platform-owned AI/OCR provider configuration. Secret fields are service-role only and must never be returned to browsers.';

create table if not exists public.hid_ai_models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.hid_ai_providers(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 160),
  model_id text not null,
  model_version text,
  purposes text[] not null default '{}',
  status public.hid_ai_provider_status not null default 'active',
  priority integer not null default 100 check (priority between 1 and 10000),
  input_cost_per_million_minor numeric check (input_cost_per_million_minor is null or input_cost_per_million_minor >= 0),
  output_cost_per_million_minor numeric check (output_cost_per_million_minor is null or output_cost_per_million_minor >= 0),
  page_cost_minor numeric check (page_cost_minor is null or page_cost_minor >= 0),
  currency char(3) not null default 'USD',
  configuration_version integer not null default 1,
  last_used_at timestamptz,
  created_by_user_profile_id uuid references public.hid_user_profiles(id),
  updated_by_user_profile_id uuid references public.hid_user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_id, model_id)
);

create table if not exists public.hid_ai_workload_routes (
  workload text primary key check (workload in (
    'ocr', 'handwriting_recognition', 'document_classification',
    'structured_data_extraction', 'clinical_entity_extraction',
    'document_summarization', 'patient_matching_assistance', 'image_understanding'
  )),
  processing_strategy public.hid_ai_processing_strategy not null default 'ocr_then_ai',
  primary_model_id uuid references public.hid_ai_models(id),
  fallback_model_id uuid references public.hid_ai_models(id),
  configuration_version integer not null default 1,
  updated_by_user_profile_id uuid references public.hid_user_profiles(id),
  updated_at timestamptz not null default now(),
  check (primary_model_id is null or primary_model_id <> fallback_model_id)
);

create table if not exists public.hid_ai_budgets (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('platform', 'provider', 'project')),
  provider_id uuid references public.hid_ai_providers(id) on delete cascade,
  migration_project_id uuid references public.hid_migration_projects(id) on delete cascade,
  monthly_budget_minor bigint not null check (monthly_budget_minor >= 0),
  currency char(3) not null default 'USD',
  warning_threshold_percent numeric not null default 80 check (warning_threshold_percent between 1 and 100),
  critical_threshold_percent numeric not null default 95 check (critical_threshold_percent between 1 and 100),
  block_non_critical boolean not null default false,
  active boolean not null default true,
  updated_by_user_profile_id uuid references public.hid_user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'platform' and provider_id is null and migration_project_id is null) or
    (scope_type = 'provider' and provider_id is not null and migration_project_id is null) or
    (scope_type = 'project' and provider_id is null and migration_project_id is not null)
  )
);
create unique index if not exists hid_ai_budget_platform_unique on public.hid_ai_budgets(scope_type) where scope_type = 'platform';
create unique index if not exists hid_ai_budget_provider_unique on public.hid_ai_budgets(provider_id) where scope_type = 'provider';
create unique index if not exists hid_ai_budget_project_unique on public.hid_ai_budgets(migration_project_id) where scope_type = 'project';

create table if not exists public.hid_ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references public.hid_ai_providers(id),
  model_id uuid references public.hid_ai_models(id),
  organization_id uuid references public.hid_organizations(id),
  migration_project_id uuid references public.hid_migration_projects(id),
  migration_job_id uuid references public.hid_migration_jobs(id),
  workload text not null,
  request_status text not null check (request_status in ('succeeded', 'failed', 'rate_limited', 'timed_out', 'retried')),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  pages_processed integer check (pages_processed is null or pages_processed >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  estimated_cost_minor numeric check (estimated_cost_minor is null or estimated_cost_minor >= 0),
  currency char(3) not null default 'USD',
  provider_quota jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index if not exists hid_ai_usage_provider_time_idx on public.hid_ai_usage_events(provider_id, occurred_at desc);
create index if not exists hid_ai_usage_project_time_idx on public.hid_ai_usage_events(migration_project_id, occurred_at desc);
create index if not exists hid_ai_usage_workload_time_idx on public.hid_ai_usage_events(workload, occurred_at desc);

create or replace function public.hid_admin_ai_usage_rollup()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with month_events as (
  select * from public.hid_ai_usage_events
  where occurred_at >= date_trunc('month', now())
),
today_events as (
  select * from month_events where occurred_at >= date_trunc('day', now())
),
month_summary as (
  select count(*)::bigint requests,
    count(*) filter(where request_status='succeeded')::bigint successful_requests,
    count(*) filter(where request_status in('failed','rate_limited','timed_out'))::bigint failed_requests,
    count(*) filter(where request_status='rate_limited')::bigint rate_limited_requests,
    count(*) filter(where request_status='timed_out')::bigint timed_out_requests,
    count(*) filter(where request_status='retried')::bigint retries,
    coalesce(sum(input_tokens),0)::bigint input_tokens,
    coalesce(sum(output_tokens),0)::bigint output_tokens,
    coalesce(sum(pages_processed),0)::bigint pages_processed,
    coalesce(sum(estimated_cost_minor),0) estimated_cost_minor,
    coalesce(avg(latency_ms) filter(where latency_ms is not null),0) average_latency_ms
  from month_events
),
today_summary as (
  select count(*)::bigint requests,
    count(*) filter(where request_status='succeeded')::bigint successful_requests,
    count(*) filter(where request_status in('failed','rate_limited','timed_out'))::bigint failed_requests,
    count(*) filter(where request_status='rate_limited')::bigint rate_limited_requests,
    count(*) filter(where request_status='timed_out')::bigint timed_out_requests,
    count(*) filter(where request_status='retried')::bigint retries,
    coalesce(sum(input_tokens),0)::bigint input_tokens,
    coalesce(sum(output_tokens),0)::bigint output_tokens,
    coalesce(sum(pages_processed),0)::bigint pages_processed,
    coalesce(sum(estimated_cost_minor),0) estimated_cost_minor,
    coalesce(avg(latency_ms) filter(where latency_ms is not null),0) average_latency_ms
  from today_events
),
provider_month as (
  select coalesce(provider_id::text,'not_provided') key,count(*)::bigint requests,
    count(*) filter(where request_status='succeeded')::bigint successful_requests,
    count(*) filter(where request_status in('failed','rate_limited','timed_out'))::bigint failed_requests,
    count(*) filter(where request_status='rate_limited')::bigint rate_limited_requests,
    count(*) filter(where request_status='retried')::bigint retries,
    coalesce(sum(input_tokens),0)::bigint input_tokens,coalesce(sum(output_tokens),0)::bigint output_tokens,
    coalesce(sum(pages_processed),0)::bigint pages_processed,coalesce(sum(estimated_cost_minor),0) estimated_cost_minor,
    coalesce(avg(latency_ms) filter(where latency_ms is not null),0) average_latency_ms,
    (array_agg(provider_quota order by occurred_at desc))[1] provider_quota
  from month_events group by provider_id
),
provider_today as (
  select coalesce(provider_id::text,'not_provided') key,count(*)::bigint requests,
    count(*) filter(where request_status='succeeded')::bigint successful_requests,
    count(*) filter(where request_status in('failed','rate_limited','timed_out'))::bigint failed_requests,
    count(*) filter(where request_status='rate_limited')::bigint rate_limited_requests,
    count(*) filter(where request_status='retried')::bigint retries,
    coalesce(sum(input_tokens),0)::bigint input_tokens,coalesce(sum(output_tokens),0)::bigint output_tokens,
    coalesce(sum(pages_processed),0)::bigint pages_processed,coalesce(sum(estimated_cost_minor),0) estimated_cost_minor,
    coalesce(avg(latency_ms) filter(where latency_ms is not null),0) average_latency_ms,
    (array_agg(provider_quota order by occurred_at desc))[1] provider_quota
  from today_events group by provider_id
),
workload_month as (
  select workload key,count(*)::bigint requests,
    count(*) filter(where request_status='succeeded')::bigint successful_requests,
    count(*) filter(where request_status in('failed','rate_limited','timed_out'))::bigint failed_requests,
    count(*) filter(where request_status='retried')::bigint retries,
    coalesce(sum(input_tokens),0)::bigint input_tokens,coalesce(sum(output_tokens),0)::bigint output_tokens,
    coalesce(sum(pages_processed),0)::bigint pages_processed,coalesce(sum(estimated_cost_minor),0) estimated_cost_minor,
    coalesce(avg(latency_ms) filter(where latency_ms is not null),0) average_latency_ms
  from month_events group by workload
),
project_month as (
  select migration_project_id,count(*)::bigint requests,
    count(*) filter(where request_status='succeeded')::bigint successful_requests,
    count(*) filter(where request_status in('failed','rate_limited','timed_out'))::bigint failed_requests,
    count(*) filter(where request_status='retried')::bigint retries,
    coalesce(sum(input_tokens),0)::bigint input_tokens,coalesce(sum(output_tokens),0)::bigint output_tokens,
    coalesce(sum(pages_processed),0)::bigint pages_processed,coalesce(sum(estimated_cost_minor),0) estimated_cost_minor,
    coalesce(avg(latency_ms) filter(where latency_ms is not null),0) average_latency_ms
  from month_events where migration_project_id is not null group by migration_project_id
)
select jsonb_build_object(
  'today',(select to_jsonb(today_summary) from today_summary),
  'month',(select to_jsonb(month_summary) from month_summary),
  'by_provider',coalesce((select jsonb_agg(to_jsonb(provider_month)) from provider_month),'[]'::jsonb),
  'today_by_provider',coalesce((select jsonb_agg(to_jsonb(provider_today)) from provider_today),'[]'::jsonb),
  'by_workload',coalesce((select jsonb_agg(to_jsonb(workload_month)) from workload_month),'[]'::jsonb),
  'by_project',coalesce((select jsonb_agg(to_jsonb(project_month)) from project_month),'[]'::jsonb)
)
$$;
revoke all on function public.hid_admin_ai_usage_rollup() from public, anon, authenticated;
grant execute on function public.hid_admin_ai_usage_rollup() to service_role;

-- Configuration and platform-wide usage are deliberately service-role only.
alter table public.hid_ai_providers enable row level security;
alter table public.hid_ai_models enable row level security;
alter table public.hid_ai_workload_routes enable row level security;
alter table public.hid_ai_budgets enable row level security;
alter table public.hid_ai_usage_events enable row level security;
revoke all on public.hid_ai_providers, public.hid_ai_models, public.hid_ai_workload_routes,
  public.hid_ai_budgets, public.hid_ai_usage_events from anon, authenticated;

insert into public.hid_ai_workload_routes(workload)
select workload from unnest(array[
  'ocr', 'handwriting_recognition', 'document_classification',
  'structured_data_extraction', 'clinical_entity_extraction',
  'document_summarization', 'patient_matching_assistance', 'image_understanding'
]) workload
on conflict (workload) do nothing;

create or replace function public.hid_pin_ai_processing_configuration()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  workload_name text;
  route_row record;
begin
  if coalesce(new.payload, '{}'::jsonb) ? 'processing_configuration' then
    return new;
  end if;
  workload_name := case new.job_type
    when 'ocr' then 'ocr'
    when 'classify' then 'document_classification'
    when 'extract' then 'structured_data_extraction'
    else null
  end;
  if workload_name is null then return new; end if;

  select
    route.configuration_version as route_version,
    route.processing_strategy,
    primary_model.id as primary_model_id,
    primary_model.model_id as primary_model_name,
    primary_model.model_version as primary_model_version,
    primary_model.configuration_version as primary_model_configuration_version,
    primary_provider.id as primary_provider_id,
    primary_provider.name as primary_provider_name,
    primary_provider.configuration_version as primary_provider_configuration_version,
    fallback_model.id as fallback_model_id,
    fallback_model.model_id as fallback_model_name,
    fallback_model.model_version as fallback_model_version,
    fallback_model.configuration_version as fallback_model_configuration_version,
    fallback_provider.id as fallback_provider_id,
    fallback_provider.name as fallback_provider_name,
    fallback_provider.configuration_version as fallback_provider_configuration_version
  into route_row
  from public.hid_ai_workload_routes route
  left join public.hid_ai_models primary_model on primary_model.id = route.primary_model_id
  left join public.hid_ai_providers primary_provider on primary_provider.id = primary_model.provider_id
  left join public.hid_ai_models fallback_model on fallback_model.id = route.fallback_model_id
  left join public.hid_ai_providers fallback_provider on fallback_provider.id = fallback_model.provider_id
  where route.workload = workload_name;

  if route_row.primary_model_id is null then return new; end if;
  new.provider := route_row.primary_provider_name;
  new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object(
    'processing_configuration', jsonb_build_object(
      'workload', workload_name,
      'route_version', route_row.route_version,
      'processing_strategy', route_row.processing_strategy,
      'primary_provider_id', route_row.primary_provider_id,
      'primary_provider_name', route_row.primary_provider_name,
      'primary_provider_configuration_version', route_row.primary_provider_configuration_version,
      'primary_model_id', route_row.primary_model_id,
      'primary_model_name', route_row.primary_model_name,
      'primary_model_version', route_row.primary_model_version,
      'primary_model_configuration_version', route_row.primary_model_configuration_version,
      'fallback_provider_id', route_row.fallback_provider_id,
      'fallback_provider_name', route_row.fallback_provider_name,
      'fallback_provider_configuration_version', route_row.fallback_provider_configuration_version,
      'fallback_model_id', route_row.fallback_model_id,
      'fallback_model_name', route_row.fallback_model_name,
      'fallback_model_version', route_row.fallback_model_version,
      'fallback_model_configuration_version', route_row.fallback_model_configuration_version
    )
  );
  return new;
end $$;

drop trigger if exists hid_pin_ai_processing_configuration on public.hid_migration_jobs;
create trigger hid_pin_ai_processing_configuration
before insert on public.hid_migration_jobs
for each row execute function public.hid_pin_ai_processing_configuration();

commit;
