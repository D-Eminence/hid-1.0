import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { buildCacheHeaders, HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { assertPlatformFeatureEnabled } from '../_shared/platform.ts'
type AdminClient=any
const required=(v:unknown,n:string)=>{const s=`${v??''}`.trim();if(!s)throw new HttpError(400,`${n} is required.`);return s}
const text=(v:unknown)=>`${v??''}`.trim()
const normalized=(type:string,v:unknown)=>type==='hid_code'?text(v).toUpperCase():type==='email'?text(v).toLowerCase():type==='phone'?text(v).replace(/[^0-9+]/g,''):text(v).toLowerCase().replace(/\s+/g,'')
const fieldValue=(fields:Record<string,unknown>,names:string[])=>{for(const name of names){const field=fields[name] as Record<string,unknown>|undefined;if(field?.value!=null)return field.value}return null}
const maskPhone=(v:string|null)=>v?v.length>4?`${v.slice(0,4)}••••${v.slice(-2)}`:'••••':null

Deno.serve(req=>withErrorHandling(req,async()=>{
 const auth=await requireUser(req);if(!auth.staffAccount?.id)throw new HttpError(403,'An active HID staff account is required.')
 const admin:AdminClient=createAdminClient();await assertPlatformFeatureEnabled(admin,'migrate')
 const url=new URL(req.url),method=req.method
 if(method==='GET'){
  const projectId=required(url.searchParams.get('project_id'),'project_id'),folderId=required(url.searchParams.get('source_folder_id'),'source_folder_id')
  const access=await auth.client.rpc('hid_has_migration_project_access',{target_project_id:projectId})
  if(access.error||!access.data)throw new HttpError(403,'You cannot open this matching queue.')
  const result=await admin.from('hid_migration_match_candidates').select('*').eq('migration_project_id',projectId).eq('source_folder_id',folderId).order('score',{ascending:false})
  const decision=await admin.from('hid_migration_match_decisions').select('*').eq('migration_project_id',projectId).eq('source_folder_id',folderId).is('revoked_at',null).maybeSingle()
  if(result.error)throw new HttpError(400,result.error.message,result.error)
  return json({data:{candidates:result.data??[],decision:decision.data??null}},200,buildCacheHeaders({maxAgeSeconds:0}))
 }
 if(method!=='POST')throw new HttpError(405,'Method not allowed.')
 const body=await readJson<Record<string,unknown>>(req),projectId=required(body.project_id,'project_id'),folderId=required(body.source_folder_id,'source_folder_id'),action=required(body.action,'action')
 const capability=await auth.client.rpc('hid_has_migration_capability',{target_project_id:projectId,required_capability:'match.decide'})
 if(capability.error||!capability.data)throw new HttpError(403,'Your migration role cannot manage patient matches.')
 const project=await admin.from('hid_migration_projects').select('organization_id,facility_id').eq('id',projectId).single()
 if(project.error)throw new HttpError(404,'Migration project not found.')
 const folder=await admin.from('hid_migration_source_folders').select('id,folder_reference,version').eq('id',folderId).eq('migration_project_id',projectId).single()
 if(folder.error)throw new HttpError(404,'Source folder not found.')
 if(action==='revoke'){
  const reason=required(body.reason,'reason')
  const current=await admin.from('hid_migration_match_decisions').select('*').eq('source_folder_id',folderId).is('revoked_at',null).single()
  if(current.error)throw new HttpError(404,'No active match decision exists.')
  const imported=await admin.from('hid_migration_import_items').select('id,status').eq('source_folder_id',folderId).maybeSingle()
  if(imported.data&&['imported','verification_failed'].includes(imported.data.status)){
   const correction=await admin.from('hid_migration_correction_cases').insert({organization_id:project.data.organization_id,facility_id:project.data.facility_id,migration_project_id:projectId,source_folder_id:folderId,import_item_id:imported.data.id,case_type:'wrong_patient',status:'frozen',reason,opened_by_staff_account_id:auth.staffAccount.id}).select('*').single()
   if(correction.error)throw new HttpError(400,correction.error.message,correction.error)
   await admin.from('hid_migration_import_items').update({status:'correction_required',actor_staff_account_id:auth.staffAccount.id}).eq('id',imported.data.id)
   return json({data:{correction_case:correction.data,decision:current.data}})
  }
  const revoked=await admin.from('hid_migration_match_decisions').update({revoked_at:new Date().toISOString(),revoked_by_staff_account_id:auth.staffAccount.id,reason}).eq('id',current.data.id).select('*').single()
  if(revoked.error)throw new HttpError(400,revoked.error.message,revoked.error)
  return json({data:revoked.data})
 }
 const folderDocuments=await admin.from('hid_migration_documents').select('id').eq('source_folder_id',folderId)
 const folderDocumentIds=(folderDocuments.data??[]).map((document:any)=>document.id)
 if(!folderDocumentIds.length)throw new HttpError(409,'This folder has no documents ready for matching.')
 const extractionVersions=await admin.from('hid_migration_extractions').select('id,source_document_id,version').in('source_document_id',folderDocumentIds).order('version',{ascending:false})
 const latestExtractionIds=[...new Map((extractionVersions.data??[]).map((row:any)=>[row.source_document_id,row.id])).values()]
 const validations=latestExtractionIds.length?await admin.from('hid_migration_validation_tasks').select('id,status').in('extraction_id',latestExtractionIds):{data:[]}
 if(!(validations.data??[]).length||(validations.data??[]).some((task:any)=>!['approved','corrected'].includes(task.status)))throw new HttpError(409,'Every extracted document must complete validation before patient matching.')
 const validationIds=(validations.data??[]).map((task:any)=>task.id)
 const qa=await admin.from('hid_migration_qa_tasks').select('status').in('validation_task_id',validationIds)
 if((qa.data??[]).some((task:any)=>task.status!=='approved'))throw new HttpError(409,'Required QA review must be approved before patient matching.')
 if(action==='generate'){
  const extractions=await admin.from('hid_migration_extractions').select('fields,version').in('source_document_id',folderDocumentIds).order('version',{ascending:false})
  const fields=Object.assign({},...(extractions.data??[]).reverse().map((v:any)=>v.fields as Record<string,unknown>))
  const identifiers=[
   ['hid_code',fieldValue(fields,['hid_code','hid_number'])],
   ['phone',fieldValue(fields,['phone_e164','phone','phone_number'])],
   ['email',fieldValue(fields,['email','email_address'])],
   ['hospital_number',fieldValue(fields,['hospital_number','hospital_no'])],
   ['legacy_folder_number',fieldValue(fields,['legacy_folder_number','folder_number'])??folder.data.folder_reference],
  ].filter(([,v])=>text(v))
  const patientIds=new Set<string>()
  for(const[type,raw]of identifiers){
   let query=admin.from('hid_patient_identifiers').select('patient_id').eq('identifier_type',type).eq('normalized_value',normalized(`${type}`,raw))
   if(!['hid_code','phone','email'].includes(`${type}`))query=query.eq('organization_id',project.data.organization_id)
   const matches=await query.limit(20);for(const match of matches.data??[])patientIds.add(match.patient_id)
  }
  if(!patientIds.size)return json({data:{candidates:[],source:{folder_reference:folder.data.folder_reference},message:'No identifier-qualified candidates found.'}})
  const patients=await admin.from('hid_patients').select('id,hid_code,full_name,dob,gender,phone_e164,email').in('id',[...patientIds])
  const fullName=text(fieldValue(fields,['full_name','patient_full_name','patient_name']))
  const dob=text(fieldValue(fields,['dob','date_of_birth']))
  const rows=(patients.data??[]).map((patient:any)=>{
   const features:{name:number;dob:number;identifier:number}={name:fullName&&normalized('name',fullName)===normalized('name',patient.full_name)?1:0,dob:dob&&dob===patient.dob?1:0,identifier:1}
   const score=Math.min(1,.65*features.identifier+.2*features.name+.15*features.dob)
   return{organization_id:project.data.organization_id,facility_id:project.data.facility_id,migration_project_id:projectId,source_folder_id:folderId,source_version:folder.data.version??1,patient_id:patient.id,score,band:score>=.999?'exact':score>=.95?'strong':score>=.75?'possible':'weak',features,conflicts:[],masked_patient_snapshot:{hid_code:patient.hid_code,full_name:patient.full_name,dob:patient.dob,gender:patient.gender,phone:maskPhone(patient.phone_e164),email:patient.email?`${patient.email.slice(0,2)}•••@${patient.email.split('@')[1]??''}`:null}}
  })
  const saved=await admin.from('hid_migration_match_candidates').upsert(rows,{onConflict:'source_folder_id,source_version,patient_id'}).select('*')
  if(saved.error)throw new HttpError(400,saved.error.message,saved.error)
  return json({data:{candidates:saved.data??[],source:{full_name:fullName,dob,folder_reference:folder.data.folder_reference}}})
 }
 if(action==='decide'){
  const decision=required(body.decision,'decision'),allowed=['link_existing','create_new_pending','review_later','escalate']
  if(!allowed.includes(decision))throw new HttpError(400,'Unsupported match decision.')
  const candidateId=body.candidate_id?required(body.candidate_id,'candidate_id'):null
  let patientId:string|null=null
  if(decision==='link_existing'){
   if(!candidateId)throw new HttpError(400,'candidate_id is required when linking a patient.')
   const candidate=await admin.from('hid_migration_match_candidates').select('patient_id').eq('id',candidateId).eq('source_folder_id',folderId).single()
   if(candidate.error)throw new HttpError(404,'Match candidate not found.');patientId=candidate.data.patient_id
  }
  const result=await admin.from('hid_migration_match_decisions').insert({organization_id:project.data.organization_id,facility_id:project.data.facility_id,migration_project_id:projectId,source_folder_id:folderId,source_version:folder.data.version??1,decision,patient_id:patientId,candidate_id:candidateId,reason:body.reason??null,actor_staff_account_id:auth.staffAccount.id}).select('*').single()
  if(result.error)throw new HttpError(result.error.code==='23505'?409:400,result.error.code==='23505'?'A final match decision already exists.':result.error.message,result.error)
  return json({data:result.data})
 }
 throw new HttpError(400,'Unsupported matching operation.')
}))
