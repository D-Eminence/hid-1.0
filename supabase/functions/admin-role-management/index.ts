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

type PlatformAdminListRow = {
  profile_id: string
  auth_user_id: string
  display_name: string | null
  email: string | null
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  active: boolean
  mfa_required: boolean
  created_at: string
  updated_at: string
}

type PlatformAdminProfileStateRow = {
  id: string
  auth_user_id: string
  display_name: string | null
  active: boolean
  mfa_required: boolean
  created_at: string
  updated_at: string
}

type Payload = {
  action?: 'create_admin' | 'update_staff_role_policy'
  email?: string | null
  fullName?: string | null
  role?: string | null
  changes?: Record<string, unknown> | null
}

function delay(ms: number) {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
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
  return profiles.map(profile => ({
      profileId: profile.profile_id,
      authUserId: profile.auth_user_id,
      displayName: profile.display_name,
      email: profile.email,
      emailConfirmedAt: profile.email_confirmed_at,
      lastSignInAt: profile.last_sign_in_at,
      active: profile.active,
      mfaRequired: profile.mfa_required,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    }))
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
      .select('id, auth_user_id, display_name, active, mfa_required, created_at, updated_at')
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

Deno.serve(req => withErrorHandling(req, async () => {
  const auth = await requireRole(req, ['platform_admin'])
  const adminClient = createAdminClient()

  if (req.method === 'GET') {
    const [admins, staffRolePolicies] = await Promise.all([
      listPlatformAdmins(adminClient),
      listStaffRolePolicies(adminClient),
    ])

    return json({ data: { admins, staffRolePolicies } }, 200, buildCacheHeaders({
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
      const data = await createPlatformAdmin(req, adminClient, actor, body)
      return json({ data }, 201)
    }

    if (action === 'update_staff_role_policy') {
      const data = await updateStaffRolePolicy(adminClient, actor, body)
      return json({ data })
    }

    throw new HttpError(400, 'That role management action is not supported.')
  }

  throw new HttpError(405, 'Method not allowed.')
}))
