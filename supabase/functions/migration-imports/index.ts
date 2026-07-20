import{createAdminClient,requireUser}from'../_shared/auth.ts'
import{buildCacheHeaders,HttpError,json,readJson,withErrorHandling}from'../_shared/http.ts'
import{assertPlatformFeatureEnabled}from'../_shared/platform.ts'
type AdminClient=any
const required=(v:unknown,n:string)=>{const s=`${v??''}`.trim();if(!s)throw new HttpError(400,`${n} is required.`);return s}
Deno.serve(req=>withErrorHandling(req,async()=>{
 const auth=await requireUser(req);if(!auth.staffAccount?.id||!auth.profile?.id)throw new HttpError(403,'An active HID staff account is required.')
 const staffId=auth.staffAccount.id,profileId=auth.profile.id
 const admin:AdminClient=createAdminClient();await assertPlatformFeatureEnabled(admin,'migrate')
 const url=new URL(req.url)
 if(req.method==='GET'){
  const projectId=required(url.searchParams.get('project_id'),'project_id')
  const access=await auth.client.rpc('hid_has_migration_project_access',{target_project_id:projectId})
  if(access.error||!access.data)throw new HttpError(403,'You cannot open this import queue.')
  const result=await admin.from('hid_migration_import_jobs').select('*,items:hid_migration_import_items(*,patient:hid_patients(hid_code,full_name))').eq('migration_project_id',projectId).order('created_at',{ascending:false}).limit(50)
  if(result.error)throw new HttpError(400,result.error.message,result.error)
  return json({data:result.data??[],page:{next_cursor:null}},200,buildCacheHeaders({maxAgeSeconds:0}))
 }
 if(req.method!=='POST')throw new HttpError(405,'Method not allowed.')
 const body=await readJson<Record<string,unknown>>(req),projectId=required(body.project_id,'project_id'),action=required(body.action,'action')
 const capability=await auth.client.rpc('hid_has_migration_capability',{target_project_id:projectId,required_capability:'import.execute'})
 if(capability.error||!capability.data)throw new HttpError(403,'Your migration role cannot execute imports.')
 const project=await admin.from('hid_migration_projects').select('organization_id,facility_id').eq('id',projectId).single()
 if(project.error)throw new HttpError(404,'Migration project not found.')
 if(action==='create_job'){
  const key=required(body.idempotency_key,'idempotency_key')
  const decisions=await admin.from('hid_migration_match_decisions').select('id,source_folder_id,source_version,patient_id,decision').eq('migration_project_id',projectId).is('revoked_at',null)
  if(decisions.error)throw new HttpError(400,decisions.error.message,decisions.error)
  const eligible=(decisions.data??[]).filter((v:any)=>v.decision==='link_existing'&&v.patient_id)
  if(!eligible.length)throw new HttpError(409,'No linked, validated folders are ready for import.')
  const job=await admin.from('hid_migration_import_jobs').upsert({organization_id:project.data.organization_id,facility_id:project.data.facility_id,migration_project_id:projectId,status:'queued',idempotency_key:key,requested_by_staff_account_id:staffId,total_items:eligible.length},{onConflict:'migration_project_id,idempotency_key'}).select('*').single()
  if(job.error)throw new HttpError(400,job.error.message,job.error)
  const items=eligible.map((v:any)=>({organization_id:project.data.organization_id,facility_id:project.data.facility_id,migration_project_id:projectId,import_job_id:job.data.id,source_folder_id:v.source_folder_id,source_version:v.source_version,match_decision_id:v.id,patient_id:v.patient_id,actor_staff_account_id:staffId,status:'ready',idempotency_key:`folder:${v.source_folder_id}:v${v.source_version}`}))
  const saved=await admin.from('hid_migration_import_items').upsert(items,{onConflict:'migration_project_id,idempotency_key',ignoreDuplicates:true}).select('*')
  if(saved.error)throw new HttpError(400,saved.error.message,saved.error)
  return json({data:{...job.data,items:saved.data??[]}})
 }
 const itemId=required(body.item_id,'item_id')
 const item=await admin.from('hid_migration_import_items').select('*').eq('id',itemId).eq('migration_project_id',projectId).single()
 if(item.error)throw new HttpError(404,'Import item not found.')
 if(action==='execute_item'||action==='retry_item'){
  if(!['ready','failed','verification_failed'].includes(item.data.status))throw new HttpError(409,'This import item is not executable.')
  const result=await admin.rpc('hid_execute_migration_import_item',{target_item_id:itemId,actor_profile_id:profileId,actor_staff_id:staffId})
  if(result.error)throw new HttpError(400,result.error.message,result.error)
  if(result.data?.status==='failed')throw new HttpError(409,`Import failed safely (${result.data.error_code??'IMPORT_FAILED'}). The item is available for retry.`)
  return json({data:result.data})
 }
 if(action==='verify_item'){
  if(item.data.status!=='imported')throw new HttpError(409,'Only imported items can be verified.')
  const ids=item.data.target_record_ids as string[]
  const records=await admin.from('hid_medical_records').select('id,current_version_id,source_provenance').in('id',ids)
  const valid=(records.data??[]).length===ids.length&&(records.data??[]).every((v:any)=>v.current_version_id&&v.source_provenance?.import_item_id===itemId)
  const update=await admin.from('hid_migration_import_items').update({status:valid?'imported':'verification_failed',verified_at:valid?new Date().toISOString():null,last_error_code:valid?null:'TARGET_VERIFICATION_FAILED',updated_at:new Date().toISOString()}).eq('id',itemId).select('*').single()
  if(!valid)throw new HttpError(409,'One or more canonical targets failed verification.')
  return json({data:update.data})
 }
 throw new HttpError(400,'Unsupported import operation.')
}))
