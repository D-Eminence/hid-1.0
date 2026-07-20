import {createAdminClient,requireUser} from '../_shared/auth.ts'
import {buildCacheHeaders,HttpError,json,readJson,withErrorHandling} from '../_shared/http.ts'
import {assertPlatformFeatureEnabled} from '../_shared/platform.ts'
type AdminClient=any
const required=(v:unknown,n:string)=>{const s=`${v??''}`.trim();if(!s)throw new HttpError(400,`${n} is required.`);return s}
const sha=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(v=>v.toString(16).padStart(2,'0')).join('')

Deno.serve(req=>withErrorHandling(req,async()=>{
 const auth=await requireUser(req);if(!auth.staffAccount?.id)throw new HttpError(403,'An active HID staff account is required.')
 const admin:AdminClient=createAdminClient();await assertPlatformFeatureEnabled(admin,'migrate')
 const url=new URL(req.url)
 if(req.method==='GET'){
  const projectId=required(url.searchParams.get('project_id'),'project_id'),type=url.searchParams.get('type')==='qa'?'qa':'validation'
  const cap=type==='qa'?'qa.decide':'validation.decide'
  const allowed=await auth.client.rpc('hid_has_migration_capability',{target_project_id:projectId,required_capability:cap})
  if(allowed.error||!allowed.data)throw new HttpError(403,'Your migration role cannot open this review queue.')
  const table=type==='qa'?'hid_migration_qa_tasks':'hid_migration_validation_tasks'
  const select=type==='qa'
   ?'*,validation_task:hid_migration_validation_tasks(*,extraction:hid_migration_extractions(*),document:hid_migration_documents(id,document_reference,title))'
   : '*,extraction:hid_migration_extractions(*),document:hid_migration_documents(id,document_reference,title)'
  const result=await admin.from(table).select(select).eq('migration_project_id',projectId).in('status',['pending','claimed']).order('created_at',{ascending:true}).limit(100)
  if(result.error)throw new HttpError(400,result.error.message,result.error)
  return json({data:result.data??[],page:{next_cursor:null}},200,buildCacheHeaders({maxAgeSeconds:0}))
 }
 if(req.method!=='POST')throw new HttpError(405,'Method not allowed.')
 const body=await readJson<Record<string,unknown>>(req),projectId=required(body.project_id,'project_id')
 const type=body.task_type==='qa'?'qa':'validation',action=required(body.action,'action'),taskId=required(body.task_id,'task_id')
 const cap=type==='qa'?'qa.decide':'validation.decide'
 const allowed=await auth.client.rpc('hid_has_migration_capability',{target_project_id:projectId,required_capability:cap})
 if(allowed.error||!allowed.data)throw new HttpError(403,'Your migration role cannot decide this task.')
 if(action==='claim'){
  const claimed=await admin.rpc('hid_claim_migration_review_task',{target_task_type:type,target_task_id:taskId,target_staff_account_id:auth.staffAccount.id,lease_minutes:15})
  if(claimed.error)throw new HttpError(409,claimed.error.message,claimed.error)
  return json({data:claimed.data})
 }
 const table=type==='qa'?'hid_migration_qa_tasks':'hid_migration_validation_tasks'
 const task=await admin.from(table).select('*').eq('id',taskId).eq('migration_project_id',projectId).single()
 if(task.error)throw new HttpError(404,'Review task not found.')
 if(action==='release'){
  if(task.data.lease_owner_staff_account_id!==auth.staffAccount.id)throw new HttpError(409,'Only the current lease owner may release this task.')
  const released=await admin.from(table).update({status:'pending',lease_owner_staff_account_id:null,lease_expires_at:null,updated_at:new Date().toISOString()}).eq('id',taskId).select('*').single()
  return json({data:released.data})
 }
 if(task.data.lease_owner_staff_account_id!==auth.staffAccount.id||!task.data.lease_expires_at||new Date(task.data.lease_expires_at)<=new Date())throw new HttpError(409,'Claim this task before recording a decision.')
 const project=await admin.from('hid_migration_projects').select('validation_policy').eq('id',projectId).single()
 if(type==='validation'&&project.data?.validation_policy?.prevent_self_validation&&task.data.captured_by_staff_account_id===auth.staffAccount.id)throw new HttpError(409,'Project policy prevents validating your own capture.')
 const decisions=type==='qa'?['approved','returned','escalated']:['approved','corrected','rejected','sent_back']
 if(!decisions.includes(action))throw new HttpError(400,'Unsupported review decision.')
 const version=Number(task.data.decision_version)+1,now=new Date().toISOString()
 if(type==='validation'){
  const extraction=await admin.from('hid_migration_extractions').select('fields,document_category,overall_confidence').eq('id',task.data.extraction_id).single()
  const decision=await admin.from('hid_migration_validation_decisions').insert({organization_id:task.data.organization_id,migration_project_id:projectId,validation_task_id:taskId,version,decision:action,corrected_fields:body.corrected_fields??null,reason:body.reason??null,actor_staff_account_id:auth.staffAccount.id,extraction_hash:await sha(extraction.data)}).select('*').single()
  if(decision.error)throw new HttpError(400,decision.error.message,decision.error)
  await admin.from(table).update({status:action,decision_version:version,decided_by_staff_account_id:auth.staffAccount.id,decided_at:now,lease_owner_staff_account_id:null,lease_expires_at:null,updated_at:now}).eq('id',taskId)
  if(['approved','corrected'].includes(action)){
   const rate=Number(project.data?.validation_policy?.qa_sample_rate??0),confidence=Number(extraction.data?.overall_confidence??1)
   const samplingReason=confidence<.85?'low_confidence':Math.random()<rate?'random':null
   if(samplingReason)await admin.from('hid_migration_qa_tasks').upsert({organization_id:task.data.organization_id,facility_id:task.data.facility_id,migration_project_id:projectId,source_document_id:task.data.source_document_id,validation_task_id:taskId,sampling_reason:samplingReason},{onConflict:'validation_task_id',ignoreDuplicates:true})
  }
  return json({data:decision.data})
 }
 const validation=await admin.from('hid_migration_validation_tasks').select('decided_by_staff_account_id,decision_version').eq('id',task.data.validation_task_id).single()
 if(project.data?.validation_policy?.require_independent_qa&&validation.data?.decided_by_staff_account_id===auth.staffAccount.id)throw new HttpError(409,'Project policy requires an independent QA reviewer.')
 const decision=await admin.from('hid_migration_qa_decisions').insert({organization_id:task.data.organization_id,migration_project_id:projectId,qa_task_id:taskId,version,decision:action,reason:body.reason??null,actor_staff_account_id:auth.staffAccount.id,validation_decision_version:validation.data?.decision_version??0}).select('*').single()
 if(decision.error)throw new HttpError(400,decision.error.message,decision.error)
 await admin.from(table).update({status:action,decision_version:version,decided_by_staff_account_id:auth.staffAccount.id,decided_at:now,lease_owner_staff_account_id:null,lease_expires_at:null,updated_at:now}).eq('id',taskId)
 return json({data:decision.data})
}))
