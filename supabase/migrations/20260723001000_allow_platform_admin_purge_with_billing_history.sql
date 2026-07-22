begin;

-- Billing configuration belongs to HID, not to the administrator who last
-- edited it. Retain the configuration while allowing that administrator's
-- Auth account to be permanently removed.
alter table public.hid_commercial_products
  drop constraint if exists hid_commercial_products_updated_by_fkey;

alter table public.hid_commercial_products
  add constraint hid_commercial_products_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;

alter table public.hid_platform_billing_settings
  drop constraint if exists hid_platform_billing_settings_updated_by_fkey;

alter table public.hid_platform_billing_settings
  add constraint hid_platform_billing_settings_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;

commit;
