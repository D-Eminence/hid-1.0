import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { HttpError } from './http.ts'

type AdminClient = ReturnType<typeof createClient>
type CacheEntry<T> = {
  expiresAt: number
  value: T
}

export type PlatformControlsRow = {
  maintenance_mode: boolean
  patient_signup_enabled: boolean
  hospital_signup_enabled: boolean
  patient_portal_enabled: boolean
  hospital_portal_enabled: boolean
  break_glass_enabled: boolean
  uploads_enabled: boolean
  updated_at: string
  updated_by_user_profile_id: string | null
}

export type StaffRolePolicyRow = {
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

export type StaffRoleCapability =
  | 'can_open_dashboard'
  | 'can_use_standard_access'
  | 'can_view_patient_records'
  | 'can_create_records'
  | 'can_use_break_glass'
  | 'can_view_history'

const DEFAULT_PLATFORM_CONTROLS: PlatformControlsRow = {
  maintenance_mode: false,
  patient_signup_enabled: true,
  hospital_signup_enabled: true,
  patient_portal_enabled: true,
  hospital_portal_enabled: true,
  break_glass_enabled: true,
  uploads_enabled: true,
  updated_at: new Date(0).toISOString(),
  updated_by_user_profile_id: null,
}
const PLATFORM_CONTROLS_TTL_MS = 2_000
const STAFF_ROLE_POLICY_TTL_MS = 5_000
let platformControlsCache: CacheEntry<PlatformControlsRow> | null = null
const staffRolePolicyCache = new Map<string, CacheEntry<StaffRolePolicyRow>>()

function now() {
  return Date.now()
}

function readFreshCache<T>(entry: CacheEntry<T> | null) {
  if (!entry) return null
  if (entry.expiresAt <= now()) return null
  return entry.value
}

function writeCacheEntry<T>(value: T, ttlMs: number): CacheEntry<T> {
  return {
    value,
    expiresAt: now() + ttlMs,
  }
}

function portalUnavailableMessage(role: string) {
  if (role === 'patient') return 'The patient portal is temporarily unavailable right now.'
  if (role === 'clinician' || role === 'org_admin') return 'The hospital portal is temporarily unavailable right now.'
  return 'This portal is temporarily unavailable right now.'
}

function staffCapabilityMessage(capability: StaffRoleCapability) {
  switch (capability) {
    case 'can_open_dashboard':
      return 'Your hospital role is not allowed to open the hospital dashboard right now.'
    case 'can_use_standard_access':
      return 'Your hospital role is not allowed to request or open patient access right now.'
    case 'can_view_patient_records':
      return 'Your hospital role is not allowed to open patient records right now.'
    case 'can_create_records':
      return 'Your hospital role is not allowed to create or update records right now.'
    case 'can_use_break_glass':
      return 'Your hospital role is not allowed to trigger emergency access right now.'
    case 'can_view_history':
      return 'Your hospital role is not allowed to view access history right now.'
    default:
      return 'Your hospital role is not allowed to perform this action right now.'
  }
}

export async function loadPlatformControls(adminClient: AdminClient) {
  const cached = readFreshCache(platformControlsCache)
  if (cached) {
    return cached
  }

  const response = await adminClient
    .from('hid_platform_controls')
    .select('maintenance_mode, patient_signup_enabled, hospital_signup_enabled, patient_portal_enabled, hospital_portal_enabled, break_glass_enabled, uploads_enabled, updated_at, updated_by_user_profile_id')
    .eq('id', true)
    .maybeSingle()

  if (response.error) {
    throw new HttpError(400, response.error.message, response.error)
  }

  const controls = {
    ...DEFAULT_PLATFORM_CONTROLS,
    ...(response.data ?? {}),
  } satisfies PlatformControlsRow

  platformControlsCache = writeCacheEntry(controls, PLATFORM_CONTROLS_TTL_MS)
  return controls
}

export async function assertPlatformPortalAccess(adminClient: AdminClient, role: string) {
  const controls = await loadPlatformControls(adminClient)

  if (role !== 'platform_admin' && controls.maintenance_mode) {
    throw new HttpError(503, 'HID is under scheduled maintenance right now. Please try again shortly.')
  }

  if (role === 'patient' && !controls.patient_portal_enabled) {
    throw new HttpError(503, portalUnavailableMessage(role))
  }

  if ((role === 'clinician' || role === 'org_admin') && !controls.hospital_portal_enabled) {
    throw new HttpError(503, portalUnavailableMessage(role))
  }

  return controls
}

export async function assertPlatformFeatureEnabled(
  adminClient: AdminClient,
  feature: 'break_glass' | 'uploads',
) {
  const controls = await loadPlatformControls(adminClient)

  if (feature === 'break_glass' && !controls.break_glass_enabled) {
    throw new HttpError(503, 'Emergency access is temporarily disabled by HID platform controls.')
  }

  if (feature === 'uploads' && !controls.uploads_enabled) {
    throw new HttpError(503, 'Record file uploads are temporarily disabled by HID platform controls.')
  }

  return controls
}

export async function loadStaffRolePolicy(adminClient: AdminClient, role: string) {
  const rawRole = `${role ?? ''}`.trim()
  const normalizedRole = rawRole.toLowerCase()
  if (!rawRole) {
    throw new HttpError(403, 'A valid hospital role is required for this action.')
  }

  const cached = readFreshCache(staffRolePolicyCache.get(normalizedRole) ?? null)
  if (cached) {
    return cached
  }

  const response = await adminClient
    .from('hid_staff_role_policies')
    .select('role, can_open_dashboard, can_use_standard_access, can_view_patient_records, can_create_records, can_use_break_glass, can_view_history, updated_at, updated_by_user_profile_id')
    .eq('role', rawRole)
    .maybeSingle()

  if (response.error) {
    throw new HttpError(400, response.error.message, response.error)
  }

  if (!response.data) {
    throw new HttpError(403, 'This hospital role is not configured for access right now.')
  }

  const policy = response.data as StaffRolePolicyRow
  staffRolePolicyCache.set(normalizedRole, writeCacheEntry(policy, STAFF_ROLE_POLICY_TTL_MS))
  return policy
}

export async function assertStaffRoleCapability(
  adminClient: AdminClient,
  role: string,
  capability: StaffRoleCapability,
) {
  const policy = await loadStaffRolePolicy(adminClient, role)
  if (!policy[capability]) {
    throw new HttpError(403, staffCapabilityMessage(capability))
  }
  return policy
}

export function invalidatePlatformControlsCache() {
  platformControlsCache = null
}

export function invalidateStaffRolePolicyCache(role?: string | null) {
  const normalizedRole = `${role ?? ''}`.trim().toLowerCase()
  if (!normalizedRole) {
    staffRolePolicyCache.clear()
    return
  }

  staffRolePolicyCache.delete(normalizedRole)
}
