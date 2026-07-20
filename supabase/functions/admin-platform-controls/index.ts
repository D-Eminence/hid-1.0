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
  'outreach_signup_enabled',
  'outreach_portal_enabled',
  'migrate_portal_enabled',
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

type OutreachCampaignRow = {
  id: string
  name: string
  org: string
  location: string
  status: string
  starts_at: string
  ends_at: string | null
  created_at: string
}

type OutreachWorkerRow = {
  id: string
  display_name: string
  role: string
  campaign_id: string
  created_at: string
}

type OutreachInviteRow = {
  id: string
  campaign_id: string
  role: string
  use_count: number
  max_uses: number
  expires_at: string | null
  created_at: string
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
    outreachSignupEnabled: controls.outreach_signup_enabled,
    outreachPortalEnabled: controls.outreach_portal_enabled,
    migratePortalEnabled: controls.migrate_portal_enabled,
    breakGlassEnabled: controls.break_glass_enabled,
    uploadsEnabled: controls.uploads_enabled,
    updatedAt: controls.updated_at,
    updatedByUserProfileId: controls.updated_by_user_profile_id,
    updatedByName,
    updatedByEmail,
  }
}

async function loadOutreachControls(adminClient: ReturnType<typeof createAdminClient>) {
  const [campaignsResult, workersResult, invitesResult, encountersResult, referralsResult] = await Promise.all([
    adminClient
      .from('hid_outreach_campaigns')
      .select('id, name, org, location, status, starts_at, ends_at, created_at')
      .order('created_at', { ascending: false })
      .limit(6),
    adminClient
      .from('hid_outreach_workers')
      .select('id, display_name, role, campaign_id, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    adminClient
      .from('hid_outreach_invites')
      .select('id, campaign_id, role, use_count, max_uses, expires_at, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    adminClient
      .from('hid_outreach_encounters')
      .select('id, status, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    adminClient
      .from('hid_outreach_referrals')
      .select('id, urgency, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  for (const result of [campaignsResult, workersResult, invitesResult, encountersResult, referralsResult]) {
    if (result.error) throw new HttpError(400, result.error.message, result.error)
  }

  const campaigns = (campaignsResult.data ?? []) as OutreachCampaignRow[]
  const workers = (workersResult.data ?? []) as OutreachWorkerRow[]
  const invites = (invitesResult.data ?? []) as OutreachInviteRow[]
  const encounters = (encountersResult.data ?? []) as Array<{ status: string }>
  const referrals = (referralsResult.data ?? []) as Array<{ urgency: string }>
  const openInvites = invites.filter(invite => (
    invite.use_count < invite.max_uses && (!invite.expires_at || new Date(invite.expires_at) > new Date())
  ))

  return {
    summary: {
      activeCampaigns: campaigns.filter(campaign => campaign.status === 'active').length,
      plannedCampaigns: campaigns.filter(campaign => campaign.status === 'planned').length,
      closedCampaigns: campaigns.filter(campaign => campaign.status === 'closed').length,
      workers: workers.length,
      openInvites: openInvites.length,
      encounters: encounters.length,
      queuedEncounters: encounters.filter(encounter => encounter.status === 'queued').length,
      referrals: referrals.length,
      urgentReferrals: referrals.filter(referral => referral.urgency === 'urgent').length,
    },
    campaigns: campaigns.map(campaign => ({
      id: campaign.id,
      name: campaign.name,
      org: campaign.org,
      location: campaign.location,
      status: campaign.status,
      startsAt: campaign.starts_at,
      endsAt: campaign.ends_at,
      createdAt: campaign.created_at,
    })),
    workers: workers.map(worker => ({
      id: worker.id,
      displayName: worker.display_name,
      role: worker.role,
      campaignId: worker.campaign_id,
      createdAt: worker.created_at,
    })),
    invites: invites.map(invite => ({
      id: invite.id,
      campaignId: invite.campaign_id,
      role: invite.role,
      useCount: invite.use_count,
      maxUses: invite.max_uses,
      expiresAt: invite.expires_at,
      createdAt: invite.created_at,
      active: invite.use_count < invite.max_uses && (!invite.expires_at || new Date(invite.expires_at) > new Date()),
    })),
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

  const [controls, outreach] = await Promise.all([
    decorateControls(adminClient),
    loadOutreachControls(adminClient),
  ])

  return {
    controls: {
      ...controls,
      outreach,
    },
  }
}

Deno.serve(req => withErrorHandling(req, async () => {
  const auth = await requireRole(req, ['platform_admin'])
  const adminClient = createAdminClient()

  if (req.method === 'GET') {
    const [controls, outreach] = await Promise.all([
      decorateControls(adminClient),
      loadOutreachControls(adminClient),
    ])

    return json({
      data: {
        controls: {
          ...controls,
          outreach,
        },
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
