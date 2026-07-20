import { createAdminClient } from '../_shared/auth.ts'
import { decryptProviderApiKey } from '../_shared/ai-provider-secrets.ts'
import { requireEnv } from '../_shared/env.ts'
import { HttpError,json,readJson,withErrorHandling } from '../_shared/http.ts'
type AdminClient=any
const workerToken=requireEnv('MIGRATION_WORKER_TOKEN')
const check=(req:Request)=>{if(req.headers.get('X-Migration-Worker-Token')!==workerToken)throw new HttpError(401,'Worker authentication required.')}

async function runtimeProvider(admin:AdminClient,providerId:unknown){
 if(!providerId)return null
 const result=await admin.from('hid_ai_providers').select('id,name,provider_type,provider_kind,api_base_url,api_version,organization_reference,project_reference,request_timeout_ms,max_retry_count,status,api_key_ciphertext,api_key_iv').eq('id',`${providerId}`).single()
 if(result.error||!result.data||result.data.status!=='active')return null
 return{
  id:result.data.id,name:result.data.name,provider_type:result.data.provider_type,provider_kind:result.data.provider_kind,
  api_base_url:result.data.api_base_url,api_version:result.data.api_version,
  organization_reference:result.data.organization_reference,project_reference:result.data.project_reference,
  request_timeout_ms:result.data.request_timeout_ms,max_retry_count:result.data.max_retry_count,
  api_key:await decryptProviderApiKey(result.data),
 }
}

async function withRuntimeConfiguration(admin:AdminClient,job:any){
 const configuration=(job.payload as Record<string,unknown>|null)?.processing_configuration as Record<string,unknown>|undefined
 if(!configuration)return job
 const [primary,fallback]=await Promise.all([
  runtimeProvider(admin,configuration.primary_provider_id),
  runtimeProvider(admin,configuration.fallback_provider_id),
 ])
 return{...job,runtime_configuration:{...configuration,primary_provider:primary,fallback_provider:fallback}}
}

function jobWorkload(jobType:string){
 return jobType==='ocr'?'ocr':jobType==='classify'?'document_classification':jobType==='extract'?'structured_data_extraction':jobType
}

async function recordUsage(admin:AdminClient,job:any,status:string,result:Record<string,unknown>={}){
 if(!['ocr','classify','extract'].includes(job.job_type))return
 const configuration=(job.payload as Record<string,unknown>|null)?.processing_configuration as Record<string,unknown>|undefined
 const providerId=configuration?.primary_provider_id??null,modelId=configuration?.primary_model_id??null
 const insert=await admin.from('hid_ai_usage_events').insert({
  provider_id:providerId,model_id:modelId,organization_id:job.organization_id,migration_project_id:job.migration_project_id,
  migration_job_id:job.id,workload:jobWorkload(job.job_type),request_status:status,
  input_tokens:result.input_tokens??null,output_tokens:result.output_tokens??null,
  pages_processed:job.job_type==='ocr'?1:null,latency_ms:result.latency_ms??null,
  estimated_cost_minor:result.cost_minor??null,currency:`${result.currency??'USD'}`.slice(0,3).toUpperCase(),
  provider_quota:result.provider_quota??{},
 })
 if(insert.error)throw new HttpError(400,insert.error.message,insert.error)
 if(providerId){
  const update=status==='succeeded'
   ?{last_success_at:new Date().toISOString(),last_failure_code:null,average_latency_ms:result.latency_ms??null}
   :{last_failure_at:new Date().toISOString(),last_failure_code:status}
  await admin.from('hid_ai_providers').update(update).eq('id',providerId)
 }
}

Deno.serve(req=>withErrorHandling(req,async()=>{
 check(req);if(req.method!=='POST')throw new HttpError(405,'Method not allowed.')
 const admin:AdminClient=createAdminClient(),body=await readJson<Record<string,unknown>>(req),action=`${body.action??''}`
 if(action==='claim'){
  const types=Array.isArray(body.job_types)?body.job_types.map(String):[]
  const result=await admin.rpc('hid_migration_claim_jobs',{p_worker:`${body.worker_id??'worker'}`,p_job_types:types,p_limit:Number(body.limit??10),p_lease_seconds:Number(body.lease_seconds??120)})
  if(result.error)throw new HttpError(400,result.error.message,result.error)
  const claimed=await Promise.all((result.data??[]).map((job:any)=>withRuntimeConfiguration(admin,job)))
  return json({data:claimed},200,{'Cache-Control':'no-store, max-age=0','Pragma':'no-cache'})
 }
 const jobId=`${body.job_id??''}`;if(!jobId)throw new HttpError(400,'job_id is required.')
 const job=await admin.from('hid_migration_jobs').select('*').eq('id',jobId).single()
 if(job.error)throw new HttpError(404,'Job not found.')
 if(action==='heartbeat'){
  const update=await admin.from('hid_migration_jobs').update({status:'running',heartbeat_at:new Date().toISOString(),lease_expires_at:new Date(Date.now()+120000).toISOString()}).eq('id',jobId).eq('leased_by',body.worker_id).select('*').single()
  if(update.error)throw new HttpError(409,update.error.message,update.error);return json({data:update.data})
 }
 if(action==='fail'){
  const exhausted=job.data.attempt_count>=job.data.max_attempts
  const delay=Math.min(3600,Math.pow(2,job.data.attempt_count)*15)+Math.floor(Math.random()*10)
  const suppliedCode=`${body.error_code??'worker_error'}`.toLowerCase().replace(/[^a-z0-9_]/g,'_').slice(0,80)
  const safeMessages:Record<string,string>={provider_timeout:'The processing provider timed out.',provider_rate_limited:'The processing provider rate limit was reached.',invalid_source:'The source document could not be processed.',malware_detected:'The source document failed security scanning.',quality_failed:'The source document requires recapture.',worker_error:'The processing worker failed.'}
  const update=await admin.from('hid_migration_jobs').update({status:exhausted?'dead_letter':'retry_scheduled',
   available_at:new Date(Date.now()+delay*1000).toISOString(),last_error_code:suppliedCode,
   last_error_message:safeMessages[suppliedCode]??'The processing worker failed.',lease_expires_at:null,leased_by:null,
  }).eq('id',jobId).select('*').single()
  await recordUsage(admin,job.data,suppliedCode==='provider_rate_limited'?'rate_limited':suppliedCode==='provider_timeout'?'timed_out':exhausted?'failed':'retried')
  if(update.error)throw new HttpError(400,update.error.message,update.error);return json({data:update.data})
 }
 if(action==='complete'){
  const completedResult=(body.result??{}) as Record<string,unknown>
  if(job.data.job_type==='security_scan'){
   const clean=body.clean===true
   await admin.from('hid_migration_assets').update({status:clean?'accepted':'rejected'}).eq('id',job.data.asset_id)
   if(clean)await admin.from('hid_migration_jobs').upsert({...job.data,id:undefined,job_type:'image_process',status:'queued',attempt_count:0,
    idempotency_key:`image_process:${job.data.asset_id}:v1`,leased_by:null,lease_expires_at:null,created_at:undefined,updated_at:undefined},
    {onConflict:'migration_project_id,idempotency_key',ignoreDuplicates:true})
  }else if(job.data.job_type==='image_process'){
   const quality=body.quality as Record<string,unknown>|undefined
   if(quality)await admin.from('hid_migration_page_quality').insert({
    organization_id:job.data.organization_id,facility_id:job.data.facility_id,migration_project_id:job.data.migration_project_id,
    page_id:job.data.page_id,source_asset_id:job.data.asset_id,algorithm_version:`${quality.algorithm_version??'unknown'}`,
    blur_score:quality.blur_score??null,blank_score:quality.blank_score??null,crop_score:quality.crop_score??null,
    resolution_dpi:quality.resolution_dpi??null,needs_rescan:quality.needs_rescan===true,reasons:quality.reasons??[],
   })
   if(quality?.needs_rescan!==true)await admin.from('hid_migration_jobs').upsert({...job.data,id:undefined,job_type:'ocr',status:'queued',attempt_count:0,
    idempotency_key:`ocr:${job.data.asset_id}:v1`,leased_by:null,lease_expires_at:null,created_at:undefined,updated_at:undefined},
    {onConflict:'migration_project_id,idempotency_key',ignoreDuplicates:true})
  }else if(job.data.job_type==='ocr'){
   const result=body.result as Record<string,unknown>
   const versionResult=await admin.from('hid_migration_ocr_results').select('version').eq('page_id',job.data.page_id).order('version',{ascending:false}).limit(1)
   const version=((versionResult.data?.[0]?.version as number|undefined)??0)+1
   await admin.from('hid_migration_ocr_results').insert({
    organization_id:job.data.organization_id,facility_id:job.data.facility_id,migration_project_id:job.data.migration_project_id,
    source_document_id:job.data.source_document_id,page_id:job.data.page_id,source_asset_id:job.data.asset_id,job_id:jobId,version,
    provider:`${result.provider}`,provider_model:`${result.model}`,provider_request_id:result.request_id??null,
    normalized_text:`${result.text??''}`,blocks:result.blocks??[],tables:result.tables??[],confidence:result.confidence??null,
    latency_ms:result.latency_ms??null,page_cost_minor:result.cost_minor??null,
   })
   await admin.from('hid_migration_jobs').upsert({...job.data,id:undefined,job_type:'classify',status:'queued',attempt_count:0,
    page_id:null,asset_id:null,idempotency_key:`classify:${job.data.source_document_id}:v1`,
    payload:{source_document_id:job.data.source_document_id},leased_by:null,lease_expires_at:null,created_at:undefined,updated_at:undefined},
    {onConflict:'migration_project_id,idempotency_key',ignoreDuplicates:true})
  }else if(job.data.job_type==='classify'){
   const result=body.result as Record<string,unknown>
   const previous=await admin.from('hid_migration_classifications').select('version').eq('source_document_id',job.data.source_document_id).order('version',{ascending:false}).limit(1)
   const version=((previous.data?.[0]?.version as number|undefined)??0)+1
   const classification=await admin.from('hid_migration_classifications').insert({
    organization_id:job.data.organization_id,facility_id:job.data.facility_id,migration_project_id:job.data.migration_project_id,
    source_document_id:job.data.source_document_id,job_id:jobId,version,
    selected_category:result.selected_category??'unclassified',candidates:result.candidates??[],confidence:result.confidence??null,
    provider:`${result.provider}`,model:`${result.model}`,prompt_version:`${result.prompt_version}`,schema_version:`${result.schema_version}`,
   }).select('id').single()
   if(classification.error)throw new HttpError(400,classification.error.message,classification.error)
   await admin.from('hid_migration_jobs').upsert({...job.data,id:undefined,job_type:'extract',status:'queued',attempt_count:0,
    idempotency_key:`extract:${job.data.source_document_id}:classification:${classification.data.id}`,
    payload:{source_document_id:job.data.source_document_id,classification_id:classification.data.id},
    leased_by:null,lease_expires_at:null,created_at:undefined,updated_at:undefined},
    {onConflict:'migration_project_id,idempotency_key',ignoreDuplicates:true})
  }else if(job.data.job_type==='extract'){
   const result=body.result as Record<string,unknown>
   const previous=await admin.from('hid_migration_extractions').select('version').eq('source_document_id',job.data.source_document_id).order('version',{ascending:false}).limit(1)
   const version=((previous.data?.[0]?.version as number|undefined)??0)+1
   const extraction=await admin.from('hid_migration_extractions').insert({
    organization_id:job.data.organization_id,facility_id:job.data.facility_id,migration_project_id:job.data.migration_project_id,
    source_document_id:job.data.source_document_id,classification_id:(job.data.payload as Record<string,unknown>).classification_id,
    job_id:jobId,version,document_category:result.document_category,schema_name:result.schema_name,schema_version:result.schema_version,
    provider:result.provider,model:result.model,prompt_version:result.prompt_version,fields:result.fields??{},
    overall_confidence:result.overall_confidence??null,
   }).select('id').single()
   if(extraction.error)throw new HttpError(400,extraction.error.message,extraction.error)
   await admin.from('hid_migration_validation_tasks').upsert({
    organization_id:job.data.organization_id,facility_id:job.data.facility_id,migration_project_id:job.data.migration_project_id,
    source_document_id:job.data.source_document_id,extraction_id:extraction.data.id,
   },{onConflict:'extraction_id',ignoreDuplicates:true})
  }
  await recordUsage(admin,job.data,'succeeded',completedResult)
  const update=await admin.from('hid_migration_jobs').update({status:'succeeded',finished_at:new Date().toISOString(),lease_expires_at:null}).eq('id',jobId).select('*').single()
  if(update.error)throw new HttpError(400,update.error.message,update.error);return json({data:update.data})
 }
 throw new HttpError(400,'Unsupported worker action.')
}))
