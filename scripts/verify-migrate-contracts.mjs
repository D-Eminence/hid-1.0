import{readFileSync,readdirSync}from'node:fs'
import{join}from'node:path'
import{fileURLToPath}from'node:url'
const root=fileURLToPath(new URL('..',import.meta.url))
const migrationDir=join(root,'supabase','migrations')
const files=readdirSync(migrationDir).filter(name=>name.includes('migrate_phase_')||name.includes('admin_ai_processing_')).sort()
const sql=files.map(name=>readFileSync(join(migrationDir,name),'utf8')).join('\n')
const requiredTables=['hid_migration_projects','hid_migration_source_folders','hid_migration_assets','hid_migration_jobs','hid_migration_validation_tasks','hid_migration_qa_tasks','hid_migration_match_candidates','hid_migration_match_decisions','hid_migration_import_jobs','hid_migration_import_items','hid_migration_correction_cases','hid_migration_cost_events','hid_ai_providers','hid_ai_models','hid_ai_workload_routes','hid_ai_budgets','hid_ai_usage_events']
const failures=[]
for(const table of requiredTables){
 if(!sql.includes(table))failures.push(`missing table contract: ${table}`)
 if(!sql.includes(`alter table public.${table} enable row level security`))failures.push(`RLS not enabled: ${table}`)
}
for(const status of ['dead_letter','needs_rescan','correction_required','verification_failed'])if(!sql.includes(status))failures.push(`missing exceptional state: ${status}`)
for(const secretTable of ['hid_ai_providers','hid_ai_models','hid_ai_workload_routes','hid_ai_budgets','hid_ai_usage_events']){
 if(new RegExp(`grant\\s+select\\s+on[^;]*${secretTable}[^;]*to\\s+authenticated`,'i').test(sql))failures.push(`platform AI table exposed to authenticated: ${secretTable}`)
}
for(const required of ['hid_pin_ai_processing_configuration','api_key_ciphertext','configuration_version'])if(!sql.includes(required))failures.push(`missing AI processing contract: ${required}`)
for(const unsafe of [/\bpublic\s+bucket\b/i,/service_role_key\s*=/i,/console\.log\([^)]*(ocr|patient|nin|phone)/i])if(unsafe.test(sql))failures.push(`unsafe pattern: ${unsafe}`)
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log(`Verified ${files.length} HID Migrate migrations and ${requiredTables.length} RLS table contracts.`)
