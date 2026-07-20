import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { buildCacheHeaders, HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { assertPlatformFeatureEnabled, assertStaffRoleCapability } from '../_shared/platform.ts'

type MigrationRole =
  | 'migration_administrator' | 'project_manager' | 'medical_records_officer'
  | 'scanner_operator' | 'validation_officer' | 'qa_reviewer'

type AdminClient = any

type Payload = {
  action?: string
  project_id?: string
  organization_id?: string
  facility_id?: string
  staff_account_id?: string
  staff_membership_id?: string
  project_member_id?: string
  batch_id?: string | null
  migration_role?: MigrationRole
  project_reference?: string
  batch_reference?: string
  name?: string
  description?: string | null
  record_location?: string | null
  estimated_patients?: number
  estimated_folders?: number
  start_date?: string | null
  expected_completion?: string | null
  status?: string
  title?: string
  priority?: number
  due_at?: string | null
  active?: boolean
}

const PROJECT_COLUMNS = 'id, organization_id, facility_id, project_reference, name, description, record_location, estimated_patients, estimated_folders, start_date, expected_completion, status, active, created_at, updated_at'
const MEMBER_COLUMNS = 'id, migration_project_id, staff_account_id, staff_membership_id, migration_role, active, starts_at, ends_at, created_at, updated_at'
const BATCH_COLUMNS = 'id, organization_id, facility_id, migration_project_id, batch_reference, name, description, estimated_folders, status, created_at, updated_at'
const ASSIGNMENT_COLUMNS = 'id, organization_id, facility_id, migration_project_id, migration_batch_id, assigned_to_project_member_id, title, description, priority, status, due_at, completed_at, created_at, updated_at'
const ROLES: MigrationRole[] = ['migration_administrator', 'project_manager', 'medical_records_officer', 'scanner_operator', 'validation_officer', 'qa_reviewer']

function text(value: unknown, field: string, max = 160) {
  const normalized = `${value ?? ''}`.trim()
  if (!normalized) throw new HttpError(400, `${field} is required.`)
  if (normalized.length > max) throw new HttpError(400, `${field} is too long.`)
  return normalized
}

function optionalText(value: unknown, max = 1000) {
  const normalized = `${value ?? ''}`.trim()
  if (!normalized) return null
  if (normalized.length > max) throw new HttpError(400, 'A supplied text value is too long.')
  return normalized
}

function boundedInteger(value: unknown, field: string, min: number, max: number) {
  const number = Number(value ?? 0)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, `${field} must be between ${min} and ${max}.`)
  }
  return number
}

async function audit(admin: AdminClient, actor: {
  userId: string; profileId: string | null; role: string; staffId: string
}, project: { id: string; organization_id: string }, action: string, metadata: Record<string, unknown>) {
  const { error } = await admin.from('hid_audit_events').insert({
    actor_user_id: actor.userId,
    actor_profile_id: actor.profileId,
    actor_role: actor.role,
    organization_id: project.organization_id,
    resource_type: 'migration_project',
    resource_id: project.id,
    action,
    metadata: { ...metadata, actor_staff_account_id: actor.staffId, migration_project_id: project.id },
  })
  if (error) throw new HttpError(400, error.message, error)
}

async function requireProjectCapability(
  client: AdminClient,
  projectId: string,
  staffId: string,
  capability: string,
) {
  const { data: member, error } = await client
    .from('hid_migration_project_members')
    .select('migration_role, active, starts_at, ends_at, staff_membership_id')
    .eq('migration_project_id', projectId)
    .eq('staff_account_id', staffId)
    .eq('active', true)
    .maybeSingle()
  if (error) throw new HttpError(400, error.message, error)
  if (!member || new Date(member.starts_at) > new Date() || (member.ends_at && new Date(member.ends_at) <= new Date())) {
    throw new HttpError(403, 'You do not have an active assignment for this migration project.')
  }

  const capabilities: Record<string, string[]> = {
    migration_administrator: ['project.manage', 'member.manage', 'assignment.manage'],
    project_manager: ['project.manage', 'member.manage', 'assignment.manage'],
    medical_records_officer: ['assignment.manage'],
  }
  if (!(capabilities[member.migration_role] ?? []).includes(capability)) {
    throw new HttpError(403, 'Your migration role cannot perform this action.')
  }

  const { data: project, error: projectError } = await client
    .from('hid_migration_projects')
    .select('id, organization_id, facility_id, active, status')
    .eq('id', projectId)
    .eq('active', true)
    .maybeSingle()
  if (projectError) throw new HttpError(400, projectError.message, projectError)
  if (!project) throw new HttpError(404, 'Migration project not found.')
  const membership = await client.from('hid_staff_memberships')
    .select('active, organization_id, facility_id')
    .eq('id', member.staff_membership_id).eq('staff_account_id', staffId).maybeSingle()
  if (membership.error) throw new HttpError(400, membership.error.message, membership.error)
  if (!membership.data?.active || membership.data.organization_id !== project.organization_id
    || (membership.data.facility_id && membership.data.facility_id !== project.facility_id)) {
    throw new HttpError(403, 'The HID staff membership for this project is no longer active.')
  }
  return project
}

async function readReceipt(admin: AdminClient, staffId: string, key: string) {
  const { data, error } = await admin.from('hid_migration_command_receipts')
    .select('action, response_data').eq('actor_staff_account_id', staffId).eq('idempotency_key', key).maybeSingle()
  if (error) throw new HttpError(400, error.message, error)
  return data
}

async function saveReceipt(admin: AdminClient, staffId: string, key: string, action: string, response: unknown) {
  const { error } = await admin.from('hid_migration_command_receipts').insert({
    actor_staff_account_id: staffId, idempotency_key: key, action, response_data: response,
  })
  if (error && error.code !== '23505') throw new HttpError(400, error.message, error)
}

Deno.serve(req => withErrorHandling(req, async () => {
  const auth = await requireUser(req)
  if (!auth.staffAccount?.id || !auth.staffAccount.role) throw new HttpError(403, 'An active HID staff account is required.')
  const admin: AdminClient = createAdminClient()
  await assertPlatformFeatureEnabled(admin, 'migrate')
  await assertStaffRoleCapability(admin, auth.staffAccount.role, 'can_open_dashboard')

  if (req.method === 'GET') {
    const url = new URL(req.url)
    const resource = url.searchParams.get('resource') ?? 'projects'
    const projectId = url.searchParams.get('project_id')
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 25), 100))
    const offset = Math.max(0, Number(url.searchParams.get('cursor') ?? 0))

    const contextResult = await auth.client.rpc('hid_get_my_migration_context')
    if (contextResult.error) throw new HttpError(400, contextResult.error.message, contextResult.error)
    const accessibleIds = ((contextResult.data?.projects ?? []) as Array<{ id: string }>).map(project => project.id)
    if (projectId && !accessibleIds.includes(projectId)) throw new HttpError(403, 'You cannot open this migration project.')

    let query
    if (resource === 'projects') {
      if (accessibleIds.length === 0) return json({ data: [], page: { next_cursor: null } })
      query = admin.from('hid_migration_projects').select(PROJECT_COLUMNS).in('id', accessibleIds)
    } else if (resource === 'members' && projectId) {
      query = admin.from('hid_migration_project_members').select(`${MEMBER_COLUMNS}, staff:hid_staff_accounts(full_name, email, role)`).eq('migration_project_id', projectId)
    } else if (resource === 'batches' && projectId) {
      query = admin.from('hid_migration_batches').select(BATCH_COLUMNS).eq('migration_project_id', projectId)
    } else if (resource === 'assignments' && projectId) {
      query = admin.from('hid_migration_work_assignments').select(`${ASSIGNMENT_COLUMNS}, member:hid_migration_project_members(migration_role, staff:hid_staff_accounts(full_name, email))`).eq('migration_project_id', projectId)
    } else if (resource === 'eligible_staff' && projectId) {
      const project = await admin.from('hid_migration_projects').select('organization_id, facility_id').eq('id', projectId).single()
      if (project.error) throw new HttpError(400, project.error.message, project.error)
      query = admin.from('hid_staff_memberships')
        .select('id, staff_account_id, facility_id, membership_role, staff:hid_staff_accounts!inner(full_name, email, role, active, deleted_at)')
        .eq('organization_id', project.data.organization_id).eq('active', true)
        .eq('staff.active', true).is('staff.deleted_at', null)
        .or(`facility_id.is.null,facility_id.eq.${project.data.facility_id}`)
    } else if (resource === 'operations' && projectId) {
      query = admin.from('hid_migration_project_operations').select('*').eq('migration_project_id', projectId)
    } else if (resource === 'audit' && projectId) {
      const auditAccess = await auth.client.rpc('hid_has_migration_capability', { target_project_id: projectId, required_capability: 'audit.read' })
      if (auditAccess.error || !auditAccess.data) throw new HttpError(403, 'Your migration role cannot view project audit events.')
      query = admin.from('hid_audit_events').select('event_id,resource_type,resource_id,action,reason,request_id,metadata,created_at')
        .eq('metadata->>migration_project_id', projectId)
    } else {
      throw new HttpError(400, 'A supported resource and project_id are required.')
    }

    const result = resource === 'operations'
      ? await query.limit(1)
      : await query.order('created_at', { ascending: false }).range(offset, offset + limit)
    if (result.error) throw new HttpError(400, result.error.message, result.error)
    const rows = result.data ?? []
    return json({
      data: rows.slice(0, limit),
      page: { next_cursor: rows.length > limit ? String(offset + limit) : null },
    }, 200, buildCacheHeaders({ maxAgeSeconds: 0 }))
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')
  const payload = await readJson<Payload>(req)
  const action = text(payload.action, 'action', 80)
  const idempotencyKey = text(req.headers.get('Idempotency-Key'), 'Idempotency-Key', 160)
  const existing = await readReceipt(admin, auth.staffAccount.id, idempotencyKey)
  if (existing) {
    if (existing.action !== action) throw new HttpError(409, 'That idempotency key was used for a different action.')
    return json({ data: existing.response_data })
  }

  const actor = {
    userId: auth.user.id,
    profileId: auth.profile?.id ?? null,
    role: auth.profile?.app_role ?? 'clinician',
    staffId: auth.staffAccount.id,
  }
  let response: unknown

  if (action === 'create_project') {
    const organizationId = text(payload.organization_id, 'organization_id')
    const facilityId = text(payload.facility_id, 'facility_id')
    const membershipResult = await admin.from('hid_staff_memberships')
      .select('id, app_role, active, facility_id')
      .eq('staff_account_id', actor.staffId).eq('organization_id', organizationId).eq('active', true)
    if (membershipResult.error) throw new HttpError(400, membershipResult.error.message, membershipResult.error)
    const membership = membershipResult.data?.find((row: any) => !row.facility_id || row.facility_id === facilityId)
    if (!membership) throw new HttpError(403, 'No active HID membership covers this organization and facility.')

    let canCreate = membership.app_role === 'org_admin'
    if (!canCreate) {
      const adminAssignments = await admin.from('hid_migration_project_members')
        .select('migration_project_id, project:hid_migration_projects!inner(organization_id)')
        .eq('staff_account_id', actor.staffId).eq('migration_role', 'migration_administrator').eq('active', true)
      if (adminAssignments.error) throw new HttpError(400, adminAssignments.error.message, adminAssignments.error)
      canCreate = (adminAssignments.data ?? []).some((row: any) => {
        const project = Array.isArray(row.project) ? row.project[0] : row.project
        return project?.organization_id === organizationId
      })
    }
    if (!canCreate) throw new HttpError(403, 'Only an organization administrator or migration administrator can create this project.')

    const insert = await admin.from('hid_migration_projects').insert({
      organization_id: organizationId,
      facility_id: facilityId,
      project_reference: text(payload.project_reference, 'project_reference', 80),
      name: text(payload.name, 'name'),
      description: optionalText(payload.description),
      record_location: optionalText(payload.record_location, 240),
      estimated_patients: boundedInteger(payload.estimated_patients, 'estimated_patients', 0, 100000000),
      estimated_folders: boundedInteger(payload.estimated_folders, 'estimated_folders', 0, 100000000),
      start_date: payload.start_date || null,
      expected_completion: payload.expected_completion || null,
      created_by_staff_account_id: actor.staffId,
      command_idempotency_key: idempotencyKey,
    }).select(PROJECT_COLUMNS).single()
    const createdProject=!insert.error
    let project=insert.data
    if(insert.error?.code==='23505'){
      const recovered=await admin.from('hid_migration_projects').select(PROJECT_COLUMNS).eq('created_by_staff_account_id',actor.staffId).eq('command_idempotency_key',idempotencyKey).single()
      if(recovered.error)throw new HttpError(409,insert.error.message,insert.error)
      project=recovered.data
    }else if(insert.error)throw new HttpError(400,insert.error.message,insert.error)
    const memberInsert = await admin.from('hid_migration_project_members').upsert({
      migration_project_id: project.id,
      staff_account_id: actor.staffId,
      staff_membership_id: membership.id,
      migration_role: 'migration_administrator',
    },{onConflict:'migration_project_id,staff_account_id'})
    if (memberInsert.error) {
      if(createdProject)await admin.from('hid_migration_projects').delete().eq('id', project.id)
      throw new HttpError(400, memberInsert.error.message, memberInsert.error)
    }
    if(createdProject)await audit(admin, actor, project, 'migration_project_created', { project_reference: project.project_reference })
    response = project
  } else {
    const projectId = text(payload.project_id, 'project_id')
    const capability = action.includes('member') ? 'member.manage' : action.includes('assignment') ? 'assignment.manage' : 'project.manage'
    const project = await requireProjectCapability(admin, projectId, actor.staffId, capability)

    if (action === 'set_project_status') {
      if (!['draft', 'active', 'paused', 'completed', 'cancelled'].includes(`${payload.status}`)) throw new HttpError(400, 'Invalid project status.')
      const transitions: Record<string, string[]> = {
        draft: ['active', 'cancelled'],
        active: ['paused', 'completed', 'cancelled'],
        paused: ['active', 'completed', 'cancelled'],
        completed: [],
        cancelled: [],
      }
      if(project.status===payload.status){
        const existingProject=await admin.from('hid_migration_projects').select(PROJECT_COLUMNS).eq('id',projectId).single()
        response=existingProject.data
      }else if (!(transitions[project.status] ?? []).includes(`${payload.status}`)) {
        throw new HttpError(409, `A ${project.status} project cannot transition to ${payload.status}.`)
      }else{
       const update = await admin.from('hid_migration_projects').update({
        status: payload.status,
        completed_at: payload.status === 'completed' ? new Date().toISOString() : null,
      }).eq('id', projectId).select(PROJECT_COLUMNS).single()
       if (update.error) throw new HttpError(400, update.error.message, update.error)
       response = update.data
       await audit(admin, actor, project, 'migration_project_status_changed', { status: payload.status })
      }
    } else if (action === 'upsert_member') {
      if (!ROLES.includes(payload.migration_role as MigrationRole)) throw new HttpError(400, 'Invalid migration role.')
      const staffId = text(payload.staff_account_id, 'staff_account_id')
      const membershipId = text(payload.staff_membership_id, 'staff_membership_id')
      const upsert = await admin.from('hid_migration_project_members').upsert({
        migration_project_id: projectId, staff_account_id: staffId, staff_membership_id: membershipId,
        migration_role: payload.migration_role, active: payload.active ?? true,
      }, { onConflict: 'migration_project_id,staff_account_id' }).select(MEMBER_COLUMNS).single()
      if (upsert.error) throw new HttpError(400, upsert.error.message, upsert.error)
      response = upsert.data
      await audit(admin, actor, project, 'migration_project_member_upserted', { member_staff_account_id: staffId, migration_role: payload.migration_role })
    } else if (action === 'set_member_active') {
      const memberId = text(payload.project_member_id, 'project_member_id')
      if (payload.active === false) {
        const target = await admin.from('hid_migration_project_members').select('migration_role')
          .eq('id', memberId).eq('migration_project_id', projectId).maybeSingle()
        if (target.error) throw new HttpError(400, target.error.message, target.error)
        if (target.data && ['migration_administrator', 'project_manager'].includes(target.data.migration_role)) {
          const count = await admin.from('hid_migration_project_members').select('id', { count: 'exact', head: true })
            .eq('migration_project_id', projectId).eq('active', true).in('migration_role', ['migration_administrator', 'project_manager'])
          if (count.error) throw new HttpError(400, count.error.message, count.error)
          if ((count.count ?? 0) <= 1) throw new HttpError(409, 'A project must retain at least one active manager.')
        }
      }
      const update = await admin.from('hid_migration_project_members').update({ active: payload.active ?? false })
        .eq('id', memberId).eq('migration_project_id', projectId).select(MEMBER_COLUMNS).single()
      if (update.error) throw new HttpError(400, update.error.message, update.error)
      response = update.data
      await audit(admin, actor, project, 'migration_project_member_access_changed', { project_member_id: memberId, active: payload.active ?? false })
    } else if (action === 'create_batch') {
      const insert = await admin.from('hid_migration_batches').insert({
        organization_id: project.organization_id, facility_id: project.facility_id, migration_project_id: projectId,
        batch_reference: text(payload.batch_reference, 'batch_reference', 80), name: text(payload.name, 'name'),
        description: optionalText(payload.description), estimated_folders: boundedInteger(payload.estimated_folders, 'estimated_folders', 0, 100000000),
        created_by_staff_account_id: actor.staffId,command_idempotency_key:idempotencyKey,
      }).select(BATCH_COLUMNS).single()
      if(insert.error?.code==='23505'){
       const recovered=await admin.from('hid_migration_batches').select(BATCH_COLUMNS).eq('created_by_staff_account_id',actor.staffId).eq('command_idempotency_key',idempotencyKey).single()
       if(recovered.error)throw new HttpError(409,insert.error.message,insert.error);response=recovered.data
      }else if(insert.error)throw new HttpError(400,insert.error.message,insert.error)
      else{response=insert.data;await audit(admin, actor, project, 'migration_batch_created', { migration_batch_id: insert.data.id })}
    } else if (action === 'create_assignment') {
      const insert = await admin.from('hid_migration_work_assignments').insert({
        organization_id: project.organization_id, facility_id: project.facility_id, migration_project_id: projectId,
        migration_batch_id: payload.batch_id || null,
        assigned_to_project_member_id: text(payload.project_member_id, 'project_member_id'),
        title: text(payload.title, 'title'), description: optionalText(payload.description),
        priority: boundedInteger(payload.priority ?? 3, 'priority', 1, 5), due_at: payload.due_at || null,
        created_by_staff_account_id: actor.staffId,command_idempotency_key:idempotencyKey,
      }).select(ASSIGNMENT_COLUMNS).single()
      if(insert.error?.code==='23505'){
       const recovered=await admin.from('hid_migration_work_assignments').select(ASSIGNMENT_COLUMNS).eq('created_by_staff_account_id',actor.staffId).eq('command_idempotency_key',idempotencyKey).single()
       if(recovered.error)throw new HttpError(409,insert.error.message,insert.error);response=recovered.data
      }else if(insert.error)throw new HttpError(400,insert.error.message,insert.error)
      else{response=insert.data;await audit(admin, actor, project, 'migration_work_assigned', { migration_assignment_id: insert.data.id })}
    } else {
      throw new HttpError(400, 'That migration operation is not supported.')
    }
  }

  await saveReceipt(admin, actor.staffId, idempotencyKey, action, response)
  return json({ data: response })
}))
