import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

function normalizeIdentifier(value: string) {
  return value.trim()
}

export type ResolvedPatientAuthIdentity = {
  authUserId: string
  authEmail: string | null
  authPhone: string | null
  fullName: string
  patientId: string
  hidCode: string
  phone: string | null
  email: string | null
  userProfileId: string
}

export type ResolvedPatientAccessState = ResolvedPatientAuthIdentity & {
  profileActive: boolean
  profileDeleted: boolean
  patientDeleted: boolean
}

type ResolvedPatientIdentityStateRow = {
  auth_user_id: string
  auth_email: string | null
  auth_phone: string | null
  patient_id: string
  user_profile_id: string
  hid_code: string
  full_name: string
  phone: string | null
  email: string | null
  profile_active: boolean
  profile_deleted: boolean
  patient_deleted: boolean
}

async function loadResolvedPatientIdentityState(
  adminClient: SupabaseClient,
  rawIdentifier: string
): Promise<ResolvedPatientIdentityStateRow | null> {
  const identifier = normalizeIdentifier(rawIdentifier)
  if (!identifier) return null

  const { data, error } = await adminClient.rpc('hid_resolve_patient_identity_state', {
    p_identifier: identifier,
  })

  if (error) {
    throw error
  }

  const row = (Array.isArray(data) ? data[0] : data) as ResolvedPatientIdentityStateRow | null
  return row ?? null
}

export async function resolvePatientAuthIdentity(
  adminClient: SupabaseClient,
  rawIdentifier: string
): Promise<ResolvedPatientAuthIdentity | null> {
  const row = await loadResolvedPatientIdentityState(adminClient, rawIdentifier)
  if (!row) return null

  return {
    authUserId: row.auth_user_id,
    authEmail: row.auth_email,
    authPhone: row.auth_phone,
    fullName: row.full_name,
    patientId: row.patient_id,
    hidCode: row.hid_code,
    phone: row.phone,
    email: row.email,
    userProfileId: row.user_profile_id,
  }
}

export async function resolvePatientAccessState(
  adminClient: SupabaseClient,
  rawIdentifier: string,
): Promise<ResolvedPatientAccessState | null> {
  const row = await loadResolvedPatientIdentityState(adminClient, rawIdentifier)
  if (!row) return null

  return {
    authUserId: row.auth_user_id,
    authEmail: row.auth_email,
    authPhone: row.auth_phone,
    fullName: row.full_name,
    patientId: row.patient_id,
    hidCode: row.hid_code,
    phone: row.phone,
    email: row.email,
    userProfileId: row.user_profile_id,
    profileActive: row.profile_active !== false,
    profileDeleted: Boolean(row.profile_deleted),
    patientDeleted: Boolean(row.patient_deleted),
  }
}

export function maskPhoneNumber(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length <= 4) return trimmed
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`
}
