begin;

do $$
declare table_name text;rls_enabled boolean;policy_count integer;
begin
 foreach table_name in array array[
  'hid_migration_projects','hid_migration_source_folders','hid_migration_assets','hid_migration_jobs',
  'hid_migration_validation_tasks','hid_migration_qa_tasks','hid_migration_match_candidates',
  'hid_migration_match_decisions','hid_migration_import_jobs','hid_migration_import_items',
  'hid_migration_correction_cases','hid_migration_cost_events'
 ] loop
  select relrowsecurity into rls_enabled from pg_class where oid=('public.'||table_name)::regclass;
  if not rls_enabled then raise exception 'RLS is disabled for %',table_name;end if;
  select count(*) into policy_count from pg_policies where schemaname='public' and tablename=table_name;
  if policy_count=0 then raise exception 'No RLS policy exists for %',table_name;end if;
 end loop;
 if has_function_privilege('authenticated','public.hid_execute_migration_import_item(uuid,uuid,uuid)','execute') then
  raise exception 'Authenticated users must not execute the privileged import RPC directly';
 end if;
 if has_function_privilege('authenticated','public.hid_migration_claim_jobs(text,text[],integer,integer)','execute') then
  raise exception 'Authenticated users must not claim worker jobs directly';
 end if;
 if not exists(select 1 from pg_trigger where tgname='validation_decisions_immutable' and tgenabled<>'D') then
  raise exception 'Validation decision immutability trigger is missing';
 end if;
 if not exists(select 1 from pg_indexes where schemaname='public' and indexname='hid_migration_one_final_match') then
  raise exception 'Final match race-prevention index is missing';
 end if;
 foreach table_name in array array[
  'hid_ai_providers','hid_ai_models','hid_ai_workload_routes','hid_ai_budgets','hid_ai_usage_events'
 ] loop
  select relrowsecurity into rls_enabled from pg_class where oid=('public.'||table_name)::regclass;
  if not rls_enabled then raise exception 'RLS is disabled for platform AI table %',table_name;end if;
  if has_table_privilege('authenticated','public.'||table_name,'select') then
   raise exception 'Platform AI table % must remain service-role only',table_name;
  end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgname='hid_pin_ai_processing_configuration' and tgenabled<>'D') then
  raise exception 'AI processing configuration pinning trigger is missing';
 end if;
 if has_function_privilege('authenticated','public.hid_admin_ai_usage_rollup()','execute') then
  raise exception 'Authenticated users must not execute the platform AI usage rollup directly';
 end if;
end $$;

rollback;
