import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

function normalizeIdentifier(value: string) {
  return value.trim()
}

function normalizePhone(value: string) {
  return value.replace(/[^0-9+]/g, '')
}

export type ResolvedPatientAuthIdentity = {
  authUserId: string
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

export async function resolvePatientAuthIdentity(
  adminClient: SupabaseClient,
  rawIdentifier: string
): Promise<ResolvedPatientAuthIdentity | null> {
  const identifier = normalizeIdentifier(rawIdentifier)
  if (!identifier) return null

  if (identifier.toUpperCase().startsWith('HID-')) {
    const { data, error } = await adminClient
      .from('hid_patients')
      .select('id, auth_user_id, user_profile_id, hid_code, full_name, phone_e164, email')
      .eq('hid_code', identifier.toUpperCase())
      .maybeSingle()

    if (error || !data) return null
    return {
      authUserId: data.auth_user_id,
      fullName: data.full_name,
      patientId: data.id,
      hidCode: data.hid_code,
      phone: data.phone_e164,
      email: data.email,
      userProfileId: data.user_profile_id,
    }
  }

  const normalizedPhone = normalizePhone(identifier)
  if (normalizedPhone) {
    const { data, error } = await adminClient
      .from('hid_patient_identifiers')
      .select('patient_id')
      .eq('identifier_type', 'phone')
      .eq('normalized_value', normalizedPhone)
      .maybeSingle()

    if (!error && data?.patient_id) {
      const { data: patientRow, error: patientError } = await adminClient
        .from('hid_patients')
        .select('id, auth_user_id, user_profile_id, hid_code, full_name, phone_e164, email')
        .eq('id', data.patient_id)
        .maybeSingle()

      if (!patientError && patientRow) {
        return {
          authUserId: patientRow.auth_user_id,
          fullName: patientRow.full_name,
          patientId: patientRow.id,
          hidCode: patientRow.hid_code,
          phone: patientRow.phone_e164,
          email: patientRow.email,
          userProfileId: patientRow.user_profile_id,
        }
      }
    }
  }

  const { data, error } = await adminClient
    .from('hid_patient_identifiers')
    .select('patient_id')
    .eq('identifier_type', 'email')
    .eq('normalized_value', identifier.toLowerCase())
    .maybeSingle()

  if (error || !data?.patient_id) return null

  const { data: patientRow, error: patientError } = await adminClient
    .from('hid_patients')
    .select('id, auth_user_id, user_profile_id, hid_code, full_name, phone_e164, email')
    .eq('id', data.patient_id)
    .maybeSingle()

  if (patientError || !patientRow) return null

  return {
    authUserId: patientRow.auth_user_id,
    fullName: patientRow.full_name,
    patientId: patientRow.id,
    hidCode: patientRow.hid_code,
    phone: patientRow.phone_e164,
    email: patientRow.email,
    userProfileId: patientRow.user_profile_id,
  }
}

export async function resolvePatientAccessState(
  adminClient: SupabaseClient,
  rawIdentifier: string,
): Promise<ResolvedPatientAccessState | null> {
  const identity = await resolvePatientAuthIdentity(adminClient, rawIdentifier)
  if (!identity) return null

  const { data, error } = await adminClient
    .from('hid_user_profiles')
    .select('active, deleted_at')
    .eq('id', identity.userProfileId)
    .maybeSingle()

  if (error) {
    throw error
  }

  const patientStateResult = await adminClient
    .from('hid_patients')
    .select('deleted_at')
    .eq('id', identity.patientId)
    .maybeSingle()

  if (patientStateResult.error) {
    throw patientStateResult.error
  }

  return {
    ...identity,
    profileActive: data?.active !== false,
    profileDeleted: Boolean(data?.deleted_at),
    patientDeleted: Boolean(patientStateResult.data?.deleted_at),
  }
}

export function maskPhoneNumber(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length <= 4) return trimmed
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`
}
