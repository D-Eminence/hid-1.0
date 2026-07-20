import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { assertPlatformFeatureEnabled } from '../_shared/platform.ts'

type Payload = Record<string, unknown>
const MIME_TYPES = new Set(['image/jpeg','image/png','image/webp','application/pdf'])
const MAX_BYTES = 52_428_800
const BUCKET = 'migration-source-files'
const str = (v: unknown, name: string) => {
  const value = `${v ?? ''}`.trim()
  if (!value) throw new HttpError(400, `${name} is required.`)
  return value
}

type AdminClient = any

async function scope(admin: AdminClient, projectId: string, staffId: string) {
  const member = await admin.from('hid_migration_project_members')
    .select('migration_role, active, staff_membership_id').eq('migration_project_id', projectId)
    .eq('staff_account_id', staffId).eq('active', true).maybeSingle()
  if (member.error) throw new HttpError(400, member.error.message, member.error)
  if (!member.data) throw new HttpError(403, 'No active assignment covers this migration project.')
  if (!['migration_administrator','project_manager','medical_records_officer','scanner_operator'].includes(member.data.migration_role)) {
    throw new HttpError(403, 'Your migration role cannot capture source records.')
  }
  const project = await admin.from('hid_migration_projects').select('id,organization_id,facility_id,status,active')
    .eq('id', projectId).eq('active', true).maybeSingle()
  if (project.error) throw new HttpError(400, project.error.message, project.error)
  if (!project.data || !['active','paused'].includes(project.data.status)) throw new HttpError(409, 'The project is not available for capture.')
  const membership = await admin.from('hid_staff_memberships').select('active,organization_id,facility_id')
    .eq('id', member.data.staff_membership_id).eq('staff_account_id', staffId).maybeSingle()
  if (membership.error || !membership.data?.active || membership.data.organization_id !== project.data.organization_id
    || (membership.data.facility_id && membership.data.facility_id !== project.data.facility_id)) {
    throw new HttpError(403, 'The HID membership for this project is no longer active.')
  }
  return project.data
}

async function log(admin: AdminClient, auth: Awaited<ReturnType<typeof requireUser>>,
  project: {id:string;organization_id:string}, action: string, resourceType: string, resourceId: string, metadata: Record<string,unknown>) {
  const result = await admin.from('hid_audit_events').insert({
    actor_user_id:auth.user.id, actor_profile_id:auth.profile?.id ?? null,
    actor_role:auth.profile?.app_role ?? 'clinician', organization_id:project.organization_id,
    resource_type:resourceType, resource_id:resourceId, action,
    metadata:{...metadata,migration_project_id:project.id,actor_staff_account_id:auth.staffAccount?.id},
  })
  if(result.error) throw new HttpError(400,result.error.message,result.error)
}

Deno.serve(req => withErrorHandling(req, async () => {
  if(req.method !== 'POST') throw new HttpError(405,'Method not allowed.')
  const auth=await requireUser(req)
  if(!auth.staffAccount?.id) throw new HttpError(403,'An active HID staff account is required.')
  const admin: AdminClient=createAdminClient()
  await assertPlatformFeatureEnabled(admin,'migrate')
  await assertPlatformFeatureEnabled(admin,'uploads')
  const body=await readJson<Payload>(req)
  const action=str(body.action,'action')
  const projectId=str(body.project_id,'project_id')
  const project=await scope(admin,projectId,auth.staffAccount.id)

  if(action==='start_session'){
    const clientSessionId=str(body.client_session_id,'client_session_id')
    const result=await admin.from('hid_migration_scan_sessions').upsert({
      organization_id:project.organization_id,facility_id:project.facility_id,migration_project_id:projectId,
      migration_batch_id:body.batch_id||null,operator_staff_account_id:auth.staffAccount.id,
      device_id:`${body.device_id??''}`.trim()||null,client_session_id:clientSessionId,
      status:'open',last_heartbeat_at:new Date().toISOString(),
    },{onConflict:'operator_staff_account_id,client_session_id'}).select('*').single()
    if(result.error) throw new HttpError(400,result.error.message,result.error)
    return json({data:result.data})
  }

  if(action==='create_folder'){
    const sessionId=str(body.scan_session_id,'scan_session_id')
    const session=await admin.from('hid_migration_scan_sessions').select('id,migration_batch_id')
      .eq('id',sessionId).eq('migration_project_id',projectId).eq('operator_staff_account_id',auth.staffAccount.id).single()
    if(session.error) throw new HttpError(403,'That capture session is not available.',session.error)
    const folder=await admin.from('hid_migration_source_folders').insert({
      organization_id:project.organization_id,facility_id:project.facility_id,migration_project_id:projectId,
      migration_batch_id:session.data.migration_batch_id,scan_session_id:sessionId,
      folder_reference:str(body.folder_reference,'folder_reference'),source_system:`${body.source_system??'physical_archive'}`,
      created_by_staff_account_id:auth.staffAccount.id,
    }).select('*').single()
    if(folder.error) throw new HttpError(folder.error.code==='23505'?409:400,folder.error.message,folder.error)
    const document=await admin.from('hid_migration_documents').insert({
      organization_id:project.organization_id,facility_id:project.facility_id,migration_project_id:projectId,
      source_folder_id:folder.data.id,document_reference:'DOC-001',title:'Source folder',
    }).select('*').single()
    if(document.error) throw new HttpError(400,document.error.message,document.error)
    await log(admin,auth,project,'migration_folder_created','migration_source_folder',folder.data.id,{scan_session_id:sessionId})
    return json({data:{folder:folder.data,document:document.data}})
  }

  if(action==='sign_upload'){
    const folderId=str(body.source_folder_id,'source_folder_id')
    const documentId=str(body.source_document_id,'source_document_id')
    const mime=str(body.mime_type,'mime_type').toLowerCase()
    const size=Number(body.size_bytes)
    const hash=str(body.sha256_hex,'sha256_hex').toLowerCase()
    if(!MIME_TYPES.has(mime)||!Number.isInteger(size)||size<1||size>MAX_BYTES||!/^[0-9a-f]{64}$/.test(hash)) {
      throw new HttpError(400,'The file type, size or checksum is not accepted.')
    }
    const folder=await admin.from('hid_migration_source_folders').select('id').eq('id',folderId).eq('migration_project_id',projectId).single()
    const document=await admin.from('hid_migration_documents').select('id').eq('id',documentId).eq('source_folder_id',folderId).single()
    if(folder.error||document.error) throw new HttpError(403,'The folder or document is outside this project.')
    const page=await admin.rpc('hid_create_migration_page',{
      p_organization_id:project.organization_id,p_facility_id:project.facility_id,p_project_id:projectId,
      p_folder_id:folderId,p_document_id:documentId,
    })
    if(page.error) throw new HttpError(409,page.error.message,page.error)
    const safeName=str(body.file_name,'file_name').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120)
    const path=`organizations/${project.organization_id}/projects/${projectId}/folders/${folderId}/documents/${documentId}/original/${page.data.id}-${safeName}`
    const asset=await admin.from('hid_migration_assets').insert({
      organization_id:project.organization_id,facility_id:project.facility_id,migration_project_id:projectId,
      source_folder_id:folderId,source_document_id:documentId,page_id:page.data.id,asset_kind:'original',
      storage_path:path,original_file_name:safeName,mime_type:mime,size_bytes:size,sha256_hex:hash,
      uploaded_by_staff_account_id:auth.staffAccount.id,
    }).select('*').single()
    if(asset.error) throw new HttpError(400,asset.error.message,asset.error)
    const signed=await admin.storage.from(BUCKET).createSignedUploadUrl(path)
    if(signed.error) throw new HttpError(502,signed.error.message,signed.error)
    return json({data:{asset:asset.data,page:page.data,signed_url:signed.data.signedUrl,token:signed.data.token,path}})
  }

  if(action==='complete_upload'){
    const assetId=str(body.asset_id,'asset_id')
    const asset=await admin.from('hid_migration_assets').select('*').eq('id',assetId).eq('migration_project_id',projectId).single()
    if(asset.error) throw new HttpError(404,'Upload asset not found.',asset.error)
    const parts=asset.data.storage_path.split('/'); const file=parts.pop()!
    const listed=await admin.storage.from(BUCKET).list(parts.join('/'),{search:file,limit:2})
    const stored=listed.data?.find((item:any)=>item.name===file)
    if(listed.error||!stored) throw new HttpError(409,'The uploaded object could not be verified.')
    const update=await admin.from('hid_migration_assets').update({status:'quarantined',uploaded_at:new Date().toISOString()})
      .eq('id',assetId).eq('status','pending_upload').select('*').single()
    if(update.error) throw new HttpError(409,update.error.message,update.error)
    await log(admin,auth,project,'migration_source_uploaded','migration_asset',assetId,{page_id:asset.data.page_id,sha256_hex:asset.data.sha256_hex})
    return json({data:update.data})
  }

  if(action==='finish_folder'){
    const folderId=str(body.source_folder_id,'source_folder_id')
    const pending=await admin.from('hid_migration_assets').select('id',{count:'exact',head:true})
      .eq('source_folder_id',folderId).eq('status','pending_upload')
    if((pending.count??0)>0) throw new HttpError(409,'All page uploads must finish before the folder can be submitted.')
    const update=await admin.from('hid_migration_source_folders').update({status:'uploaded'})
      .eq('id',folderId).eq('migration_project_id',projectId).select('*').single()
    if(update.error) throw new HttpError(400,update.error.message,update.error)
    await admin.from('hid_migration_documents').update({status:'uploaded'}).eq('source_folder_id',folderId)
    await log(admin,auth,project,'migration_folder_uploaded','migration_source_folder',folderId,{})
    return json({data:update.data})
  }
  throw new HttpError(400,'That capture operation is not supported.')
}))
