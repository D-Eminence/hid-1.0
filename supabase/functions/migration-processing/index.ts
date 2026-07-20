import { createAdminClient,requireUser } from '../_shared/auth.ts'
import { buildCacheHeaders,HttpError,json,readJson,withErrorHandling } from '../_shared/http.ts'
import { assertPlatformFeatureEnabled } from '../_shared/platform.ts'
type AdminClient=any
const value=(v:unknown,n:string)=>{const s=`${v??''}`.trim();if(!s)throw new HttpError(400,`${n} is required.`);return s}

Deno.serve(req=>withErrorHandling(req,async()=>{
 const auth=await requireUser(req)
 if(!auth.staffAccount?.id)throw new HttpError(403,'An active HID staff account is required.')
 const admin:AdminClient=createAdminClient();await assertPlatformFeatureEnabled(admin,'migrate')
 if(req.method==='GET'){
  const url=new URL(req.url),projectId=value(url.searchParams.get('project_id'),'project_id'),resource=url.searchParams.get('resource')??'jobs'
  const limit=Math.min(Math.max(Number(url.searchParams.get('limit')??25),1),100)
  const cursor=Math.max(Number(url.searchParams.get('cursor')??0),0)
  const access=await auth.client.rpc('hid_has_migration_project_access',{target_project_id:projectId})
  if(access.error||!access.data)throw new HttpError(403,'You cannot open this processing queue.')
  const result=resource==='intelligence'
   ?await admin.from('hid_migration_documents').select('id,document_reference,title,status,created_at,classifications:hid_migration_classifications(id,version,selected_category,candidates,confidence,provider,model,prompt_version,schema_version,created_at),extractions:hid_migration_extractions(id,version,document_category,schema_name,schema_version,fields,overall_confidence,provider,model,prompt_version,created_at)')
    .eq('migration_project_id',projectId).order('created_at',{ascending:false}).range(cursor,cursor+limit)
   :resource==='folders'
   ?await admin.from('hid_migration_source_folders').select('id,folder_reference,status,created_at,assets:hid_migration_assets(id,status)')
    .eq('migration_project_id',projectId).eq('status','uploaded').order('created_at',{ascending:false}).range(cursor,cursor+limit)
   :await admin.from('hid_migration_jobs').select('id,migration_project_id,source_folder_id,source_document_id,page_id,asset_id,job_type,status,provider,attempt_count,max_attempts,available_at,last_error_code,last_error_message,correlation_id,started_at,finished_at,created_at,updated_at')
    .eq('migration_project_id',projectId).order('created_at',{ascending:false}).range(cursor,cursor+limit)
  if(result.error)throw new HttpError(400,result.error.message,result.error)
  const rows=result.data??[]
  return json({data:rows.slice(0,limit),page:{next_cursor:rows.length>limit?String(cursor+limit):null}},200,buildCacheHeaders({maxAgeSeconds:0}))
 }
 if(req.method!=='POST')throw new HttpError(405,'Method not allowed.')
 const body=await readJson<Record<string,unknown>>(req),action=value(body.action,'action'),projectId=value(body.project_id,'project_id')
 const capability=await auth.client.rpc('hid_has_migration_capability',{target_project_id:projectId,required_capability:'processing.retry'})
 if(capability.error||!capability.data)throw new HttpError(403,'Your migration role cannot manage processing jobs.')
 const project=await admin.from('hid_migration_projects').select('organization_id,facility_id').eq('id',projectId).single()
 if(project.error)throw new HttpError(404,'Migration project not found.')
 if(action==='enqueue_folder'){
  const folderId=value(body.source_folder_id,'source_folder_id')
  const assets=await admin.from('hid_migration_assets').select('id,source_document_id,page_id,status')
   .eq('migration_project_id',projectId).eq('source_folder_id',folderId).eq('asset_kind','original').in('status',['quarantined','accepted'])
  if(assets.error)throw new HttpError(400,assets.error.message,assets.error)
  const jobs=(assets.data??[]).map((asset:any)=>({
   organization_id:project.data.organization_id,facility_id:project.data.facility_id,migration_project_id:projectId,
   source_folder_id:folderId,source_document_id:asset.source_document_id,page_id:asset.page_id,asset_id:asset.id,
   job_type:asset.status==='quarantined'?'security_scan':'image_process',
   idempotency_key:`${asset.status==='quarantined'?'security_scan':'image_process'}:${asset.id}:v1`,
   payload:{asset_id:asset.id},
  }))
  if(jobs.length===0)throw new HttpError(409,'No uploaded source pages are ready to queue.')
  const inserted=await admin.from('hid_migration_jobs').upsert(jobs,{onConflict:'migration_project_id,idempotency_key',ignoreDuplicates:true}).select('id,job_type,status')
  if(inserted.error)throw new HttpError(400,inserted.error.message,inserted.error)
  return json({data:inserted.data})
 }
 if(action==='retry_job'){
  const jobId=value(body.job_id,'job_id')
  const job=await admin.from('hid_migration_jobs').select('attempt_count,max_attempts,status').eq('id',jobId).eq('migration_project_id',projectId).single()
  if(job.error)throw new HttpError(404,'Processing job not found.')
  if(!['dead_letter','retry_scheduled'].includes(job.data.status)||job.data.attempt_count>=job.data.max_attempts)throw new HttpError(409,'This job is not eligible for retry.')
  const updated=await admin.from('hid_migration_jobs').update({status:'queued',available_at:new Date().toISOString(),last_error_code:null,last_error_message:null})
   .eq('id',jobId).select('*').single()
  if(updated.error)throw new HttpError(400,updated.error.message,updated.error)
  return json({data:updated.data})
 }
 throw new HttpError(400,'That processing operation is not supported.')
}))
