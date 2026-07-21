import { createAdminClient, requireRole } from '../_shared/auth.ts'
import { buildCacheHeaders, HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { invalidateStaffRolePolicyCache } from '../_shared/platform.ts'
import { asTrimmedString, optionalTrimmedString } from '../_shared/validation.ts'

const STAFF_POLICY_FIELDS = [
  'can_open_dashboard',
  'can_use_standard_access',
  'can_view_patient_records',
  'can_create_records',
  'can_use_break_glass',
  'can_view_history',
] as const

type StaffPolicyField = typeof STAFF_POLICY_FIELDS[number]

const OUTREACH_POLICY_FIELDS = [
  'can_open_workspace',
  'can_create_encounters',
  'can_manage_invites',
  'can_sync_data',
  'can_view_campaign_data',
] as const

// The primary administrator is the only account permitted to manage other
// platform-admin accounts. Keep this server-side so UI changes cannot bypass it.
const PRIMARY_PLATFORM_ADMIN_EMAIL = 'eminence742@gmail.com'
const MEDICAL_RECORD_FILES_BUCKET = 'medical-record-files'

type OutreachPolicyField = typeof OUTREACH_POLICY_FIELDS[number]

type StaffRolePolicyRow = {
  role: string
  can_open_dashboard: boolean
  can_use_standard_access: boolean
  can_view_patient_records: boolean
  can_create_records: boolean
  can_use_break_glass: boolean
  can_view_history: boolean
  updated_at: string
  updated_by_user_profile_id: string | null
}

type OutreachRolePolicyRow = {
  role: string
  can_open_workspace: boolean
  can_create_encounters: boolean
  can_manage_invites: boolean
  can_sync_data: boolean
  can_view_campaign_data: boolean
  updated_at: string
  updated_by_user_profile_id: string | null
}

type PlatformAdminListRow = {
  profile_id: string
  auth_user_id: string
  display_name: string | null
  email: string | null
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  active: boolean
  deleted_at: string | null
  mfa_required: boolean
  created_at: string
  updated_at: string
}

type PlatformAdminProfileStateRow = {
  id: string
  auth_user_id: string
  display_name: string | null
  active: boolean
  deleted_at: string | null
  deleted_reason: string | null
  mfa_required: boolean
  created_at: string
  updated_at: string
}

type Payload = {
  action?: 'create_admin' | 'delete_admin' | 'lock_admin' | 'unlock_admin' | 'update_staff_role_policy' | 'update_outreach_role_policy'
  email?: string | null
  fullName?: string | null
  role?: string | null
  changes?: Record<string, unknown> | null
  targetAuthUserId?: string | null
}

function canManagePlatformAdmins(email: string | null | undefined) {
  return email?.trim().toLowerCase() === PRIMARY_PLATFORM_ADMIN_EMAIL
}

function requirePrimaryPlatformAdmin(email: string | null | undefined) {
  if (!canManagePlatformAdmins(email)) {
    throw new HttpError(403, 'Platform admin account management is restricted to the primary HID administrator.')
  }
}

function delay(ms: number) {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function removeProfileMedicalRecordFiles(
  adminClient: ReturnType<typeof createAdminClient>,
  profileId: string,
) {
  const filesResult = await adminClient
    .from('hid_medical_record_files')
    .select('storage_path')
    .eq('uploaded_by_user_profile_id', profileId)

  if (filesResult.error) throw new HttpError(400, filesResult.error.message, filesResult.error)

  const storagePaths = [...new Set(
    (filesResult.data ?? [])
      .map(file => file.storage_path)
      .filter((path): path is string => Boolean(path)),
  )]

  for (const paths of chunk(storagePaths, 100)) {
    const { error } = await adminClient.storage.from(MEDICAL_RECORD_FILES_BUCKET).remove(paths)
    if (error) throw new HttpError(400, error.message, error)
  }
}

function normalizeRolePolicy(row: StaffRolePolicyRow) {
  return {
    role: row.role,
    canOpenDashboard: row.can_open_dashboard,
    canUseStandardAccess: row.can_use_standard_access,
    canViewPatientRecords: row.can_view_patient_records,
    canCreateRecords: row.can_create_records,
    canUseBreakGlass: row.can_use_break_glass,
    canViewHistory: row.can_view_history,
    updatedAt: row.updated_at,
    updatedByUserProfileId: row.updated_by_user_profile_id,
  }
}

function normalizeOutreachRolePolicy(row: OutreachRolePolicyRow) {
  return {
    role: row.role,
    canOpenWorkspace: row.can_open_workspace,
    canCreateEncounters: row.can_create_encounters,
    canManageInvites: row.can_manage_invites,
    canSyncData: row.can_sync_data,
    canViewCampaignData: row.can_view_campaign_data,
    updatedAt: row.updated_at,
    updatedByUserProfileId: row.updated_by_user_profile_id,
  }
}

function normalizePlatformAdmin(row: PlatformAdminListRow) {
  return {
    profileId: row.profile_id,
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    email: row.email,
    emailConfirmedAt: row.email_confirmed_at,
    lastSignInAt: row.last_sign_in_at,
    active: row.active,
    deletedAt: row.deleted_at,
    mfaRequired: row.mfa_required,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function logAdminAuditEvent(
  adminClient: ReturnType<typeof createAdminClient>,
  actor: { userId: string; profileId: string | null; role: string },
  input: {
    action: string
    metadata?: Record<string, unknown>
    reason?: string | null
    resourceId?: string | null
    resourceType: string
  },
) {
  const { error } = await adminClient.from('hid_audit_events').insert({
    actor_user_id: actor.userId,
    actor_profile_id: actor.profileId,
    actor_role: actor.role,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    action: input.action,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  })

  if (error) throw new HttpError(400, error.message, error)
}

async function listPlatformAdmins(adminClient: ReturnType<typeof createAdminClient>) {
  const profilesResult = await adminClient.rpc('hid_list_platform_admin_accounts')

  if (profilesResult.error) {
    throw new HttpError(400, profilesResult.error.message, profilesResult.error)
  }

  const profiles = (profilesResult.data ?? []) as PlatformAdminListRow[]
  return profiles.map(normalizePlatformAdmin)
}

async function listStaffRolePolicies(adminClient: ReturnType<typeof createAdminClient>) {
  const response = await adminClient
    .from('hid_staff_role_policies')
    .select('role, can_open_dashboard, can_use_standard_access, can_view_patient_records, can_create_records, can_use_break_glass, can_view_history, updated_at, updated_by_user_profile_id')
    .order('role', { ascending: true })

  if (response.error) {
    throw new HttpError(400, response.error.message, response.error)
  }

  return ((response.data ?? []) as StaffRolePolicyRow[]).map(normalizeRolePolicy)
}

async function listOutreachRolePolicies(adminClient: ReturnType<typeof createAdminClient>) {
  const response = await adminClient
    .from('hid_outreach_role_policies')
    .select('role, can_open_workspace, can_create_encounters, can_manage_invites, can_sync_data, can_view_campaign_data, updated_at, updated_by_user_profile_id')
    .order('role', { ascending: true })

  if (response.error) {
    throw new HttpError(400, response.error.message, response.error)
  }

  return ((response.data ?? []) as OutreachRolePolicyRow[]).map(normalizeOutreachRolePolicy)
}

async function lookupExactAuthUserByEmail(adminClient: ReturnType<typeof createAdminClient>, email: string) {
  const response = await adminClient.rpc('hid_admin_auth_user_search', {
    p_limit: 8,
    p_query: email,
  })

  if (response.error) {
    throw new HttpError(400, response.error.message, response.error)
  }

  const rows = (response.data ?? []) as Array<Record<string, unknown>>
  const normalizedEmail = email.trim().toLowerCase()

  return rows
    .map(row => ({
      auth_user_id: `${row.auth_user_id ?? ''}`.trim(),
      email: typeof row.email === 'string' ? row.email.toLowerCase() : null,
    }))
    .find(row => row.auth_user_id && row.email === normalizedEmail) as { auth_user_id: string; email: string | null } | undefined
}

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')
}

async function waitForPlatformAdminProfile(adminClient: ReturnType<typeof createAdminClient>, authUserId: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await adminClient
      .from('hid_user_profiles')
      .select('id, auth_user_id, display_name, active, deleted_at, deleted_reason, mfa_required, created_at, updated_at')
      .eq('auth_user_id', authUserId)
      .maybeSingle()

    if (result.error) {
      throw new HttpError(400, result.error.message, result.error)
    }

    if (result.data) {
      return result.data as PlatformAdminProfileStateRow
    }

    await delay(120 * (attempt + 1))
  }

  throw new HttpError(500, 'The platform admin account was created, but the profile is still finishing setup.')
}

async function createPlatformAdmin(
  req: Request,
  adminClient: ReturnType<typeof createAdminClient>,
  actor: { userId: string; profileId: string | null; role: string },
  payload: Payload,
) {
  const email = asTrimmedString(payload.email, 'email').toLowerCase()
  const fullName = optionalTrimmedString(payload.fullName) ?? email.split('@')[0] ?? 'Platform Admin'
  const exactMatch = await lookupExactAuthUserByEmail(adminClient, email)

  if (exactMatch?.auth_user_id) {
    throw new HttpError(409, 'An HID account already exists for this email. Use a dedicated email address for new platform admins.')
  }

  const temporaryPassword = generateTemporaryPassword()
  const createResult = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password: temporaryPassword,
    app_metadata: {
      admin_created_platform_admin: true,
      app_role: 'platform_admin',
    },
    user_metadata: {
      full_name: fullName,
      requested_role: 'platform_admin',
    },
  })

  if (createResult.error || !createResult.data.user?.id) {
    throw new HttpError(400, createResult.error?.message ?? 'The platform admin account could not be created right now.', createResult.error)
  }

  const authUserId = createResult.data.user.id

  try {
    const profile = await waitForPlatformAdminProfile(adminClient, authUserId)
    const profileUpdate = await adminClient
      .from('hid_user_profiles')
      .update({
        app_role: 'platform_admin',
        display_name: fullName,
        mfa_required: true,
        active: true,
      })
      .eq('auth_user_id', authUserId)

    if (profileUpdate.error) {
      throw new HttpError(400, profileUpdate.error.message, profileUpdate.error)
    }

    const authUpdate = await adminClient.auth.admin.updateUserById(authUserId, {
      app_metadata: {
        ...(createResult.data.user.app_metadata ?? {}),
        admin_created_platform_admin: true,
        app_role: 'platform_admin',
      },
      user_metadata: {
        ...(createResult.data.user.user_metadata ?? {}),
        full_name: fullName,
        requested_role: 'platform_admin',
      },
    })

    if (authUpdate.error) {
      throw new HttpError(400, authUpdate.error.message, authUpdate.error)
    }

    const requestUrl = new URL(req.url)
    const origin = (req.headers.get('origin') ?? `${requestUrl.protocol}//${requestUrl.host}`).replace(/\/$/, '')
    const linkResult = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${origin}/eminence/login`,
      },
    })

    if (linkResult.error || !linkResult.data.properties?.action_link) {
      throw new HttpError(400, linkResult.error?.message ?? 'The password setup link could not be created right now.', linkResult.error)
    }

    await logAdminAuditEvent(adminClient, actor, {
      action: 'admin_create_platform_admin',
      resourceId: profile.id,
      resourceType: 'user_profile',
      reason: 'Platform admin account created by HID admin',
      metadata: {
        email,
        target_auth_user_id: authUserId,
      },
    })

    const createdAdmins = await listPlatformAdmins(adminClient)
    const createdAdmin = createdAdmins.find(item => item.authUserId === authUserId) ?? {
      profileId: profile.id,
      authUserId,
      displayName: fullName,
      email,
      emailConfirmedAt: createResult.data.user.email_confirmed_at ?? null,
      lastSignInAt: createResult.data.user.last_sign_in_at ?? null,
      active: true,
      deletedAt: null,
      mfaRequired: true,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    }

    return {
      admin: createdAdmin,
      passwordSetupLink: linkResult.data.properties.action_link,
      verificationType: linkResult.data.properties.verification_type,
    }
  } catch (error) {
    await adminClient.auth.admin.deleteUser(authUserId).catch(() => undefined)
    throw error
  }
}

async function loadPlatformAdminTarget(adminClient: ReturnType<typeof createAdminClient>, authUserId: string) {
  const result = await adminClient
    .from('hid_user_profiles')
    .select('id, auth_user_id, app_role, display_name, active, deleted_at, deleted_reason, mfa_required, created_at, updated_at')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (result.error) throw new HttpError(400, result.error.message, result.error)
  const profile = result.data as (PlatformAdminProfileStateRow & { app_role: string }) | null
  if (!profile || profile.app_role !== 'platform_admin') {
    throw new HttpError(404, 'We could not find that platform admin account.')
  }

  return profile
}

async function ensurePlatformAdminContinuity(adminClient: ReturnType<typeof createAdminClient>) {
  const result = await adminClient
    .from('hid_user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('app_role', 'platform_admin')
    .eq('active', true)
    .is('deleted_at', null)

  if (result.error) throw new HttpError(400, result.error.message, result.error)
  if ((result.count ?? 0) <= 1) {
    throw new HttpError(409, 'Keep at least one active platform admin account.')
  }
}

async function applyPlatformAdminAction(
  adminClient: ReturnType<typeof createAdminClient>,
  actor: { userId: string; profileId: string | null; role: string },
  action: 'delete_admin' | 'lock_admin' | 'unlock_admin',
  targetAuthUserId: string,
) {
  if (targetAuthUserId === actor.userId) {
    throw new HttpError(403, 'You cannot change your own platform admin account from the dashboard.')
  }

  const target = await loadPlatformAdminTarget(adminClient, targetAuthUserId)
  if (action === 'unlock_admin' && target.deleted_at) {
    throw new HttpError(409, 'Deleted platform admin accounts cannot be restored from the dashboard.')
  }
  if (action === 'lock_admin' && target.deleted_at) {
    throw new HttpError(409, 'This platform admin account is already deleted.')
  }

  if ((action === 'lock_admin' || action === 'delete_admin') && target.active) {
    await ensurePlatformAdminContinuity(adminClient)
  }

  if (action === 'lock_admin') {
    const profileUpdate = await adminClient
      .from('hid_user_profiles')
      .update({ active: false })
      .eq('id', target.id)
    if (profileUpdate.error) throw new HttpError(400, profileUpdate.error.message, profileUpdate.error)

    const authUpdate = await adminClient.auth.admin.updateUserById(targetAuthUserId, { ban_duration: '876000h' })
    if (authUpdate.error) {
      await adminClient.from('hid_user_profiles').update({ active: target.active }).eq('id', target.id)
      throw new HttpError(400, authUpdate.error.message, authUpdate.error)
    }

    await logAdminAuditEvent(adminClient, actor, {
      action: 'admin_limit_platform_admin_access',
      resourceId: target.id,
      resourceType: 'user_profile',
      reason: 'Platform admin access limited by another HID admin.',
      metadata: { target_auth_user_id: targetAuthUserId },
    })
  }

  if (action === 'unlock_admin') {
    const profileUpdate = await adminClient
      .from('hid_user_profiles')
      .update({ active: true })
      .eq('id', target.id)
    if (profileUpdate.error) throw new HttpError(400, profileUpdate.error.message, profileUpdate.error)

    const authUpdate = await adminClient.auth.admin.updateUserById(targetAuthUserId, { ban_duration: 'none' })
    if (authUpdate.error) {
      await adminClient.from('hid_user_profiles').update({ active: target.active }).eq('id', target.id)
      throw new HttpError(400, authUpdate.error.message, authUpdate.error)
    }

    await logAdminAuditEvent(adminClient, actor, {
      action: 'admin_restore_platform_admin_access',
      resourceId: target.id,
      resourceType: 'user_profile',
      reason: 'Platform admin access restored by another HID admin.',
      metadata: { target_auth_user_id: targetAuthUserId },
    })
  }

  if (action === 'delete_admin') {
    await removeProfileMedicalRecordFiles(adminClient, target.id)

    const { data, error } = await adminClient.rpc('hid_permanently_delete_account_by_auth_user_id', {
      p_allow_platform_admin: true,
      p_auth_user_id: targetAuthUserId,
    })
    if (error) throw new HttpError(400, error.message, error)
    const permanentlyDeleted = (data as { deleted?: boolean } | null)?.deleted ?? false
    if (!permanentlyDeleted) {
      throw new HttpError(404, 'This platform admin account could not be permanently deleted right now.')
    }

    await logAdminAuditEvent(adminClient, actor, {
      action: 'admin_permanently_delete_platform_admin',
      resourceId: target.id,
      resourceType: 'user_profile',
      reason: 'Platform admin account permanently deleted by another HID admin.',
      metadata: { target_auth_user_id: targetAuthUserId },
    })

    return { admin: null, deletedAuthUserId: targetAuthUserId }
  }

  const admins = await listPlatformAdmins(adminClient)
  const admin = admins.find(item => item.authUserId === targetAuthUserId)
  if (!admin) throw new HttpError(500, 'The platform admin account was updated, but could not be reloaded.')

  return { admin, deletedAuthUserId: null }
}

async function updateStaffRolePolicy(
  adminClient: ReturnType<typeof createAdminClient>,
  actor: { userId: string; profileId: string | null; role: string },
  payload: Payload,
) {
  const role = asTrimmedString(payload.role, 'role')
  const rawChanges = payload.changes ?? {}
  const changes = {} as Record<StaffPolicyField | 'updated_by_user_profile_id', boolean | string | null>

  for (const field of STAFF_POLICY_FIELDS) {
    if (field in rawChanges) {
      if (typeof rawChanges[field] !== 'boolean') {
        throw new HttpError(400, `${field} must be a boolean value.`)
      }
      changes[field] = rawChanges[field] as boolean
    }
  }

  if (Object.keys(changes).length === 0) {
    throw new HttpError(400, 'Provide at least one RBAC setting to update.')
  }

  changes.updated_by_user_profile_id = actor.profileId

  const updateResult = await adminClient
    .from('hid_staff_role_policies')
    .update(changes)
    .eq('role', role)

  if (updateResult.error) {
    throw new HttpError(400, updateResult.error.message, updateResult.error)
  }

  invalidateStaffRolePolicyCache(role)

  const updatedResult = await adminClient
    .from('hid_staff_role_policies')
    .select('role, can_open_dashboard, can_use_standard_access, can_view_patient_records, can_create_records, can_use_break_glass, can_view_history, updated_at, updated_by_user_profile_id')
    .eq('role', role)
    .maybeSingle()

  if (updatedResult.error) {
    throw new HttpError(400, updatedResult.error.message, updatedResult.error)
  }
  if (!updatedResult.data) {
    throw new HttpError(404, 'That hospital role could not be found right now.')
  }

  await logAdminAuditEvent(adminClient, actor, {
    action: 'admin_update_staff_role_policy',
    resourceId: role,
    resourceType: 'staff_role_policy',
    reason: 'Hospital RBAC updated by HID admin',
    metadata: changes,
  })

  return {
    policy: normalizeRolePolicy(updatedResult.data as StaffRolePolicyRow),
  }
}

async function updateOutreachRolePolicy(
  adminClient: ReturnType<typeof createAdminClient>,
  actor: { userId: string; profileId: string | null; role: string },
  payload: Payload,
) {
  const role = asTrimmedString(payload.role, 'role')
  const rawChanges = payload.changes ?? {}
  const changes = {} as Record<OutreachPolicyField | 'updated_by_user_profile_id', boolean | string | null>

  for (const field of OUTREACH_POLICY_FIELDS) {
    if (field in rawChanges) {
      if (typeof rawChanges[field] !== 'boolean') {
        throw new HttpError(400, `${field} must be a boolean value.`)
      }
      changes[field] = rawChanges[field] as boolean
    }
  }

  if (Object.keys(changes).length === 0) {
    throw new HttpError(400, 'Provide at least one outreach RBAC setting to update.')
  }

  changes.updated_by_user_profile_id = actor.profileId

  const updateResult = await adminClient
    .from('hid_outreach_role_policies')
    .update(changes)
    .eq('role', role)

  if (updateResult.error) {
    throw new HttpError(400, updateResult.error.message, updateResult.error)
  }

  const updatedResult = await adminClient
    .from('hid_outreach_role_policies')
    .select('role, can_open_workspace, can_create_encounters, can_manage_invites, can_sync_data, can_view_campaign_data, updated_at, updated_by_user_profile_id')
    .eq('role', role)
    .maybeSingle()

  if (updatedResult.error) {
    throw new HttpError(400, updatedResult.error.message, updatedResult.error)
  }
  if (!updatedResult.data) {
    throw new HttpError(404, 'That outreach role could not be found right now.')
  }

  await logAdminAuditEvent(adminClient, actor, {
    action: 'admin_update_outreach_role_policy',
    resourceId: role,
    resourceType: 'outreach_role_policy',
    reason: 'Outreach RBAC updated by HID admin',
    metadata: changes,
  })

  return {
    policy: normalizeOutreachRolePolicy(updatedResult.data as OutreachRolePolicyRow),
  }
}

Deno.serve(req => withErrorHandling(req, async () => {
  const auth = await requireRole(req, ['platform_admin'])
  const adminClient = createAdminClient()

  if (req.method === 'GET') {
    const isPrimaryAdmin = canManagePlatformAdmins(auth.user.email)
    const [admins, staffRolePolicies, outreachRolePolicies] = await Promise.all([
      isPrimaryAdmin ? listPlatformAdmins(adminClient) : Promise.resolve([]),
      listStaffRolePolicies(adminClient),
      listOutreachRolePolicies(adminClient),
    ])

    return json({ data: { admins, canManagePlatformAdmins: isPrimaryAdmin, staffRolePolicies, outreachRolePolicies } }, 200, buildCacheHeaders({
      maxAgeSeconds: 5,
      staleWhileRevalidateSeconds: 15,
    }))
  }

  if (req.method === 'POST') {
    const body = await readJson<Payload>(req)
    const action = asTrimmedString(body.action, 'action')
    const actor = {
      userId: auth.user.id,
      profileId: auth.profile?.id ?? null,
      role: auth.role,
    }

    if (action === 'create_admin') {
      requirePrimaryPlatformAdmin(auth.user.email)
      const data = await createPlatformAdmin(req, adminClient, actor, body)
      return json({ data }, 201)
    }

    if (action === 'lock_admin' || action === 'unlock_admin' || action === 'delete_admin') {
      requirePrimaryPlatformAdmin(auth.user.email)
      const targetAuthUserId = asTrimmedString(body.targetAuthUserId, 'targetAuthUserId')
      const data = await applyPlatformAdminAction(adminClient, actor, action, targetAuthUserId)
      return json({ data })
    }

    if (action === 'update_staff_role_policy') {
      const data = await updateStaffRolePolicy(adminClient, actor, body)
      return json({ data })
    }

    if (action === 'update_outreach_role_policy') {
      const data = await updateOutreachRolePolicy(adminClient, actor, body)
      return json({ data })
    }

    throw new HttpError(400, 'That role management action is not supported.')
  }

  throw new HttpError(405, 'Method not allowed.')
}))
