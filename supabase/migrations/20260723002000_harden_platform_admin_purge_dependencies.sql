begin;

-- Keep platform billing history when an administrator is removed. This is
-- intentionally repeated as a defensive migration because older deployments
-- may have created these inline foreign keys with a different constraint name.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conrelid::regclass as table_name, conname
    from pg_constraint
    where contype = 'f'
      and confrelid = 'auth.users'::regclass
      and conrelid in ('public.hid_commercial_products'::regclass, 'public.hid_platform_billing_settings'::regclass)
      and pg_get_constraintdef(oid) ilike '%updated_by%'
  loop
    execute format('alter table %s drop constraint %I', constraint_row.table_name, constraint_row.conname);
  end loop;
end;
$$;

alter table public.hid_commercial_products
  add constraint hid_commercial_products_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;

alter table public.hid_platform_billing_settings
  add constraint hid_platform_billing_settings_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;

commit;
