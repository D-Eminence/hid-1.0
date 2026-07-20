-- HID platform commercial catalog, subscriptions and billing. This is distinct from patient billing.
create type public.hid_commercial_product_status as enum ('draft','active','coming_soon','retired');
create type public.hid_pricing_visibility as enum ('fixed','starting_from','contact_sales','custom_quote','hidden');
create type public.hid_subscription_status as enum ('trial','active','past_due','grace_period','restricted','suspended','cancelled','expired');
create type public.hid_billing_cycle as enum ('monthly','annual','one_time','usage','project','custom');

create table public.hid_commercial_products (
  id uuid primary key default gen_random_uuid(), slug text not null unique check (slug ~ '^[a-z0-9-]+$'), name text not null,
  description text not null default '', status public.hid_commercial_product_status not null default 'draft',
  available_standalone boolean not null default false, available_addon boolean not null default false,
  public_visible boolean not null default false, trial_eligible boolean not null default false,
  subscription_type text not null default 'subscription', default_billing_cycle public.hid_billing_cycle not null default 'monthly',
  setup_fee_minor bigint check (setup_fee_minor >= 0), currency text not null default 'NGN', display_order integer not null default 100,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table public.hid_commercial_prices (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.hid_commercial_products(id) on delete cascade,
  context text not null check (context in ('core','addon','standalone','usage','setup','project')),
  visibility public.hid_pricing_visibility not null default 'contact_sales', amount_minor bigint check (amount_minor >= 0),
  currency text not null default 'NGN', billing_period text, unit text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(product_id, context)
);
create table public.hid_subscription_plans (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null, description text not null default '',
  monthly_price_minor bigint check(monthly_price_minor >= 0), annual_price_minor bigint check(annual_price_minor >= 0), setup_fee_minor bigint check(setup_fee_minor >= 0), currency text not null default 'NGN',
  included_users integer, included_storage_gb integer, included_branches integer, usage_limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '[]'::jsonb, trial_days integer not null default 0 check(trial_days between 0 and 365), status text not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.hid_organization_subscriptions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.hid_organizations(id), plan_id uuid references public.hid_subscription_plans(id),
  status public.hid_subscription_status not null default 'trial', billing_cycle public.hid_billing_cycle not null default 'monthly',
  starts_at timestamptz not null default now(), trial_ends_at timestamptz, next_billing_at timestamptz, grace_ends_at timestamptz,
  override_price_minor bigint check(override_price_minor >= 0), override_reason text, outstanding_minor bigint not null default 0, currency text not null default 'NGN',
  paused_at timestamptz, cancelled_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id)
);
create table public.hid_subscription_entitlements (
  id uuid primary key default gen_random_uuid(), subscription_id uuid not null references public.hid_organization_subscriptions(id) on delete cascade,
  product_id uuid not null references public.hid_commercial_products(id), context text not null, active boolean not null default true,
  price_override_minor bigint check(price_override_minor >= 0), override_reason text, starts_at timestamptz not null default now(), ends_at timestamptz,
  unique(subscription_id, product_id, context)
);
create table public.hid_platform_invoices (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.hid_organizations(id), subscription_id uuid references public.hid_organization_subscriptions(id),
  invoice_number text not null unique, status text not null default 'draft', subtotal_minor bigint not null default 0, discount_minor bigint not null default 0,
  tax_minor bigint not null default 0, total_minor bigint not null default 0, balance_minor bigint not null default 0, currency text not null default 'NGN', due_at timestamptz, paid_at timestamptz,
  line_items jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.hid_platform_payments (
  id uuid primary key default gen_random_uuid(), invoice_id uuid references public.hid_platform_invoices(id), organization_id uuid not null references public.hid_organizations(id),
  provider text, provider_reference text, status text not null default 'pending', amount_minor bigint not null check(amount_minor >= 0), currency text not null default 'NGN', paid_at timestamptz, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table public.hid_platform_billing_settings (
  id boolean primary key default true check(id), default_currency text not null default 'NGN', default_trial_days integer not null default 14,
  grace_period_days integer not null default 14, proration_enabled boolean not null default true, late_fee_minor bigint not null default 0,
  restriction_policy jsonb not null default '{"preserve_critical_clinical_workflows":true}'::jsonb, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
insert into public.hid_platform_billing_settings(id) values(true) on conflict do nothing;

insert into public.hid_commercial_products(slug,name,description,status,available_standalone,available_addon,public_visible,subscription_type,display_order) values
('emr','HID EMR','Modular hospital operating system','active',false,false,true,'subscription',10),
('laboratory','HID Laboratory','Complete laboratory workflow','active',true,true,true,'subscription',20),
('pharmacy','HID Pharmacy','Pharmacy operations from stock to sale','active',true,true,true,'subscription',30),
('migrate','HID Migrate','Legacy patient record digitization','active',true,true,true,'usage_or_project',40),
('outreach','HID Outreach','Connected field healthcare platform','active',true,false,true,'subscription',50),
('api','HID API','Healthcare integration layer','coming_soon',false,false,true,'usage',60),
('hmo-claims','HMO & Claims','Care and coverage connectivity','coming_soon',false,true,true,'subscription',70),
('analytics','Advanced Analytics','Operational and clinical analytics','coming_soon',false,true,true,'subscription',80)
on conflict(slug) do nothing;

insert into public.hid_commercial_prices(product_id,context,visibility,amount_minor,currency,unit)
select id,'usage','starting_from',50000,'NGN','file' from public.hid_commercial_products where slug='migrate' on conflict do nothing;
insert into public.hid_commercial_prices(product_id,context,visibility,currency)
select id,case when available_addon then 'addon' else 'standalone' end,'contact_sales','NGN' from public.hid_commercial_products where slug <> 'migrate' on conflict do nothing;

create or replace view public.hid_public_product_prices with (security_invoker=true) as
select p.slug product_slug, pr.context, pr.visibility, pr.amount_minor, pr.currency, pr.billing_period, pr.unit
from public.hid_commercial_products p join public.hid_commercial_prices pr on pr.product_id=p.id
where p.public_visible and p.status in ('active','coming_soon') and pr.active and pr.visibility <> 'hidden';

alter table public.hid_commercial_products enable row level security; alter table public.hid_commercial_prices enable row level security;
alter table public.hid_subscription_plans enable row level security; alter table public.hid_organization_subscriptions enable row level security;
alter table public.hid_subscription_entitlements enable row level security; alter table public.hid_platform_invoices enable row level security;
alter table public.hid_platform_payments enable row level security; alter table public.hid_platform_billing_settings enable row level security;
grant select on public.hid_public_product_prices to anon, authenticated;
create policy "public catalog products" on public.hid_commercial_products for select using(public_visible and status in ('active','coming_soon'));
create policy "public catalog prices" on public.hid_commercial_prices for select using(active and visibility <> 'hidden' and exists(select 1 from public.hid_commercial_products p where p.id=product_id and p.public_visible));
revoke all on public.hid_subscription_plans,public.hid_organization_subscriptions,public.hid_subscription_entitlements,public.hid_platform_invoices,public.hid_platform_payments,public.hid_platform_billing_settings from anon,authenticated;

create index hid_org_subscriptions_status_idx on public.hid_organization_subscriptions(status,next_billing_at);
create index hid_platform_invoices_status_idx on public.hid_platform_invoices(status,due_at);
