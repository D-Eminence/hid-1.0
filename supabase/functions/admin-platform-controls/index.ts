import { createAdminClient, requireRole } from '../_shared/auth.ts'
import { buildCacheHeaders, HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { invalidatePlatformControlsCache, loadPlatformControls } from '../_shared/platform.ts'
import { asTrimmedString } from '../_shared/validation.ts'

const CONTROL_FIELDS = [
  'maintenance_mode',
  'patient_signup_enabled',
  'hospital_signup_enabled',
  'patient_portal_enabled',
  'hospital_portal_enabled',
  'break_glass_enabled',
  'uploads_enabled',
] as const

type ControlField = typeof CONTROL_FIELDS[number]

type Payload = {
  action?: 'update_controls'
  controls?: Record<string, unknown> | null
}

type ProfileLookupRow = {
  auth_user_id: string
  display_name: string | null
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

async function decorateControls(adminClient: ReturnType<typeof createAdminClient>) {
  const controls = await loadPlatformControls(adminClient)
  let updatedByName: string | null = null
  let updatedByEmail: string | null = null

  if (controls.updated_by_user_profile_id) {
    const profileResult = await adminClient
      .from('hid_user_profiles')
      .select('auth_user_id, display_name')
      .eq('id', controls.updated_by_user_profile_id)
      .maybeSingle()

    if (profileResult.error) {
      throw new HttpError(400, profileResult.error.message, profileResult.error)
    }

    const profile = (profileResult.data ?? null) as ProfileLookupRow | null
    updatedByName = profile?.display_name ?? null

    if (profile?.auth_user_id) {
      const authResult = await adminClient.auth.admin.getUserById(profile.auth_user_id)
      if (authResult.error) {
        throw new HttpError(400, authResult.error.message, authResult.error)
      }
      updatedByEmail = authResult.data.user?.email ?? null
    }
  }

  return {
    maintenanceMode: controls.maintenance_mode,
    patientSignupEnabled: controls.patient_signup_enabled,
    hospitalSignupEnabled: controls.hospital_signup_enabled,
    patientPortalEnabled: controls.patient_portal_enabled,
    hospitalPortalEnabled: controls.hospital_portal_enabled,
    breakGlassEnabled: controls.break_glass_enabled,
    uploadsEnabled: controls.uploads_enabled,
    updatedAt: controls.updated_at,
    updatedByUserProfileId: controls.updated_by_user_profile_id,
    updatedByName,
    updatedByEmail,
  }
}

async function updateControls(
  adminClient: ReturnType<typeof createAdminClient>,
  actor: { userId: string; profileId: string | null; role: string },
  payload: Payload,
) {
  const rawControls = payload.controls ?? {}
  const nextValues = {} as Record<ControlField | 'updated_by_user_profile_id', boolean | string | null>

  for (const field of CONTROL_FIELDS) {
    if (field in rawControls) {
      if (typeof rawControls[field] !== 'boolean') {
        throw new HttpError(400, `${field} must be a boolean value.`)
      }
      nextValues[field] = rawControls[field] as boolean
    }
  }

  if (Object.keys(nextValues).length === 0) {
    throw new HttpError(400, 'Provide at least one platform control to update.')
  }

  nextValues.updated_by_user_profile_id = actor.profileId

  const updateResult = await adminClient
    .from('hid_platform_controls')
    .upsert({
      id: true,
      ...nextValues,
    }, {
      onConflict: 'id',
    })

  if (updateResult.error) {
    throw new HttpError(400, updateResult.error.message, updateResult.error)
  }

  invalidatePlatformControlsCache()

  await logAdminAuditEvent(adminClient, actor, {
    action: 'admin_update_platform_controls',
    resourceId: 'platform_controls',
    resourceType: 'platform_controls',
    reason: 'Platform controls updated by HID admin',
    metadata: nextValues,
  })

  return {
    controls: await decorateControls(adminClient),
  }
}

Deno.serve(req => withErrorHandling(req, async () => {
  const auth = await requireRole(req, ['platform_admin'])
  const adminClient = createAdminClient()

  if (req.method === 'GET') {
    return json({
      data: {
        controls: await decorateControls(adminClient),
      },
    }, 200, buildCacheHeaders({
      maxAgeSeconds: 2,
      staleWhileRevalidateSeconds: 8,
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

    if (action === 'update_controls') {
      const data = await updateControls(adminClient, actor, body)
      return json({ data })
    }

    throw new HttpError(400, 'That platform control action is not supported.')
  }

  throw new HttpError(405, 'Method not allowed.')
}))
