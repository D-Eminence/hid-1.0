import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { HttpError } from './http.ts'

export type AdminUsersExportFormat = 'csv' | 'xlsx' | 'pdf' | 'txt'
export type AdminUsersExportScope = 'selected_user' | 'search_results' | 'selected_day' | 'last_7_days' | 'last_30_days' | 'all'

export interface AdminUsersExportFilters {
  scope: AdminUsersExportScope
  authUserId?: string | null
  query?: string | null
  date?: string | null
}

type AdminClient = ReturnType<typeof createClient>

type AuthUserRow = {
  created_at: string | null
  email: string | null
  email_confirmed_at: string | null
  id: string
  last_sign_in_at: string | null
  user_metadata: Record<string, unknown> | null
}

type MatchedAuthUserRow = {
  auth_user_id: string
  created_at: string | null
  email: string | null
  email_confirmed_at: string | null
  last_sign_in_at: string | null
}

type ProfileRow = {
  active: boolean
  app_role: string | null
  auth_user_id: string
  created_at: string
  deleted_at: string | null
  deleted_reason: string | null
  display_name: string | null
  id: string
  mfa_required: boolean
  restored_at: string | null
  updated_at: string
}

type PatientRow = {
  allergies: string | null
  blood_group: string | null
  chronic_conditions: string | null
  auth_user_id: string
  country: string | null
  created_at: string
  current_medications: string | null
  dob: string | null
  deleted_at: string | null
  deleted_reason: string | null
  email: string | null
  emergency_contact_address: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relationship: string | null
  first_name: string
  full_name: string
  gender: string | null
  genotype: string | null
  hmo_organization: string | null
  hospital_currently_using: string | null
  hid_code: string
  id: string
  last_name: string
  medical_notes: string | null
  nin_last4: string | null
  notifications_enabled: boolean
  photo_url: string | null
  profile_percent: number | null
  phone_e164: string | null
  restored_at: string | null
  state: string | null
  updated_at: string
  user_profile_id: string
}

type StaffRow = {
  active: boolean
  auth_user_id: string
  created_at: string
  deleted_at: string | null
  deleted_reason: string | null
  email: string
  full_name: string
  hospital_name: string | null
  id: string
  license_number: string | null
  phone_e164: string | null
  restored_at: string | null
  role: string
  updated_at: string
  user_profile_id: string
  verification_status: string
}

type MembershipRow = {
  active: boolean
  app_role: string
  created_at: string
  id: string
  is_primary: boolean
  membership_role: string
  staff_account_id: string
}

type MedicalRecordRow = {
  category: string
  created_at: string
  current_version_id: string | null
  id: string
  patient_id: string
  title: string
  updated_at: string
}

type MedicalRecordVersionRow = {
  created_at: string
  id: string
  notes: string | null
  record: string
  record_id: string
  transcription_text: string | null
  version_no: number
}

type MedicalRecordFileRow = {
  created_at: string
  mime_type: string | null
  original_file_name: string
  patient_id: string
  record_id: string
  size_bytes: number | string | null
}

type ExportSummaryRow = {
  active_access_grant_count: number | string | null
  health_event_count: number | string | null
  medical_record_count: number | string | null
  notification_count: number | string | null
  patient_id: string | null
  pending_access_request_count: number | string | null
  profile_id: string | null
  record_file_count: number | string | null
  record_file_storage_bytes: number | string | null
}

export type AdminUsersExportRow = {
  accountStatus: string
  authCreatedAt: string
  authUserId: string
  email: string
  emailConfirmedAt: string
  flagsDeleted: string
  flagsLocked: string
  flagsRestorable: string
  flagsRestrictable: string
  flagsStaffAccessRestricted: string
  lastSignInAt: string
  patientCountry: string
  patientCreatedAt: string
  patientCurrentMedications: string
  patientDeletedAt: string
  patientDeletedReason: string
  patientDob: string
  patientEmail: string
  patientEmergencyContactAddress: string
  patientEmergencyContactName: string
  patientEmergencyContactPhone: string
  patientEmergencyContactRelationship: string
  patientFirstName: string
  patientFullName: string
  patientGender: string
  patientGenotype: string
  patientHealthEventCount: string
  patientHmoOrganization: string
  patientHospitalCurrentlyUsing: string
  patientHidCode: string
  patientId: string
  patientMedicalNotes: string
  patientMedicalRecordCount: string
  patientMedicalRecordDetails: string
  patientMedicalRecordFileDetails: string
  patientNinLast4: string
  patientNotificationsEnabled: string
  patientPhotoUrl: string
  patientPhone: string
  patientProfilePercent: string
  patientRecordFileCount: string
  patientRecordFileStorageBytes: string
  patientRestoredAt: string
  patientState: string
  patientUpdatedAt: string
  patientActiveAccessGrantCount: string
  patientAllergies: string
  patientBloodGroup: string
  patientChronicConditions: string
  patientPendingAccessRequestCount: string
  profileActive: string
  profileAppRole: string
  profileCreatedAt: string
  profileDeletedAt: string
  profileDeletedReason: string
  profileDisplayName: string
  profileId: string
  profileMfaRequired: string
  profileNotificationCount: string
  profileRestoredAt: string
  profileUpdatedAt: string
  staffActive: string
  staffCreatedAt: string
  staffDeletedAt: string
  staffDeletedReason: string
  staffEmail: string
  staffFullName: string
  staffHospitalName: string
  staffId: string
  staffInactiveMembershipCount: string
  staffLicenseNumber: string
  staffPhone: string
  staffMembershipCount: string
  staffRestoredAt: string
  staffRole: string
  staffUpdatedAt: string
  staffVerificationStatus: string
}

export interface AdminUsersExportFile {
  bytes: Uint8Array
  contentType: string
  fileName: string
}

const ADMIN_USERS_EXPORT_COLUMNS: Array<keyof AdminUsersExportRow> = [
  'accountStatus',
  'authCreatedAt',
  'authUserId',
  'email',
  'emailConfirmedAt',
  'flagsDeleted',
  'flagsLocked',
  'flagsRestorable',
  'flagsRestrictable',
  'flagsStaffAccessRestricted',
  'lastSignInAt',
  'patientCountry',
  'patientCreatedAt',
  'patientCurrentMedications',
  'patientDeletedAt',
  'patientDeletedReason',
  'patientDob',
  'patientEmail',
  'patientEmergencyContactAddress',
  'patientEmergencyContactName',
  'patientEmergencyContactPhone',
  'patientEmergencyContactRelationship',
  'patientFirstName',
  'patientFullName',
  'patientGender',
  'patientGenotype',
  'patientHealthEventCount',
  'patientHmoOrganization',
  'patientHospitalCurrentlyUsing',
  'patientHidCode',
  'patientId',
  'patientMedicalNotes',
  'patientMedicalRecordCount',
  'patientMedicalRecordDetails',
  'patientMedicalRecordFileDetails',
  'patientNinLast4',
  'patientNotificationsEnabled',
  'patientPhotoUrl',
  'patientPhone',
  'patientProfilePercent',
  'patientRecordFileCount',
  'patientRecordFileStorageBytes',
  'patientRestoredAt',
  'patientState',
  'patientUpdatedAt',
  'patientActiveAccessGrantCount',
  'patientAllergies',
  'patientBloodGroup',
  'patientChronicConditions',
  'patientPendingAccessRequestCount',
  'profileActive',
  'profileAppRole',
  'profileCreatedAt',
  'profileDeletedAt',
  'profileDeletedReason',
  'profileDisplayName',
  'profileId',
  'profileMfaRequired',
  'profileNotificationCount',
  'profileRestoredAt',
  'profileUpdatedAt',
  'staffActive',
  'staffCreatedAt',
  'staffDeletedAt',
  'staffDeletedReason',
  'staffEmail',
  'staffFullName',
  'staffHospitalName',
  'staffId',
  'staffInactiveMembershipCount',
  'staffLicenseNumber',
  'staffPhone',
  'staffMembershipCount',
  'staffRestoredAt',
  'staffRole',
  'staffUpdatedAt',
  'staffVerificationStatus',
]

function normalizeText(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function displayValue(value: string) {
  return value.trim() ? value : 'N/A'
}

function normalizeSearchValue(value: string | null | undefined) {
  return `${value ?? ''}`.trim().toLowerCase()
}

function escapeCsv(value: string) {
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapePdfText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function toAsciiTimestamp(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toISOString()
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function chunk(values: string[], size: number) {
  const chunks: string[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

async function loadChunkedRows<T>(
  values: string[],
  size: number,
  loader: (chunkValues: string[]) => Promise<T[]>,
) {
  const rows: T[] = []
  for (const chunkValues of chunk(values, size)) {
    const nextRows = await loader(chunkValues)
    rows.push(...nextRows)
  }
  return rows
}

async function listAllAuthUsers(adminClient: AdminClient) {
  const users: AuthUserRow[] = []
  let page = 1
  const perPage = 1000

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    })

    if (error) {
      throw new HttpError(400, error.message, error)
    }

    const nextUsers = ((data?.users ?? []) as Array<Record<string, unknown>>).map(user => ({
      created_at: typeof user.created_at === 'string' ? user.created_at : null,
      email: typeof user.email === 'string' ? user.email : null,
      email_confirmed_at: typeof user.email_confirmed_at === 'string' ? user.email_confirmed_at : null,
      id: String(user.id ?? ''),
      last_sign_in_at: typeof user.last_sign_in_at === 'string' ? user.last_sign_in_at : null,
      user_metadata: (user.user_metadata && typeof user.user_metadata === 'object') ? user.user_metadata as Record<string, unknown> : null,
    }))

    users.push(...nextUsers)
    if (nextUsers.length < perPage) break
    page += 1
  }

  return users
}

async function getAuthUsersByIds(adminClient: AdminClient, authUserIds: string[]) {
  const uniqueAuthUserIds = unique(authUserIds).filter(Boolean)
  if (uniqueAuthUserIds.length === 0) return [] as AuthUserRow[]

  const users = await Promise.all(uniqueAuthUserIds.map(async authUserId => {
    const { data, error } = await adminClient.auth.admin.getUserById(authUserId)
    if (error) {
      throw new HttpError(400, error.message, error)
    }

    const user = data.user
    if (!user) return null

    return {
      created_at: typeof user.created_at === 'string' ? user.created_at : null,
      email: typeof user.email === 'string' ? user.email : null,
      email_confirmed_at: typeof user.email_confirmed_at === 'string' ? user.email_confirmed_at : null,
      id: authUserId,
      last_sign_in_at: typeof user.last_sign_in_at === 'string' ? user.last_sign_in_at : null,
      user_metadata: (user.user_metadata && typeof user.user_metadata === 'object') ? user.user_metadata as Record<string, unknown> : null,
    } satisfies AuthUserRow
  }))

  return users.filter((user): user is AuthUserRow => Boolean(user))
}

async function lookupAuthUsersByEmail(adminClient: AdminClient, query: string) {
  const matches = new Map<string, MatchedAuthUserRow>()
  const { data, error } = await adminClient.rpc('hid_admin_auth_user_search', {
    p_limit: 20,
    p_query: query,
  })

  if (error) {
    throw new HttpError(400, error.message, error)
  }

  for (const row of ((data ?? []) as Array<Record<string, unknown>>)) {
    const authUserId = `${row.auth_user_id ?? ''}`.trim()
    if (!authUserId) continue
    matches.set(authUserId, {
      auth_user_id: authUserId,
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
      email: typeof row.email === 'string' ? row.email : null,
      email_confirmed_at: typeof row.email_confirmed_at === 'string' ? row.email_confirmed_at : null,
      last_sign_in_at: typeof row.last_sign_in_at === 'string' ? row.last_sign_in_at : null,
    })
  }

  return matches
}

async function loadAuthUsersCreatedBetween(adminClient: AdminClient, startIso: string, endIso: string) {
  const { data, error } = await adminClient.rpc('hid_admin_auth_users_created_between', {
    p_end: endIso,
    p_start: startIso,
  })

  if (!error) {
    return ((data ?? []) as Array<Record<string, unknown>>)
      .map(row => {
        const authUserId = `${row.auth_user_id ?? ''}`.trim()
        if (!authUserId) return null
        return {
          created_at: typeof row.created_at === 'string' ? row.created_at : null,
          email: typeof row.email === 'string' ? row.email : null,
          email_confirmed_at: typeof row.email_confirmed_at === 'string' ? row.email_confirmed_at : null,
          id: authUserId,
          last_sign_in_at: typeof row.last_sign_in_at === 'string' ? row.last_sign_in_at : null,
          user_metadata: null,
        } satisfies AuthUserRow
      })
      .filter((row): row is AuthUserRow => Boolean(row))
  }

  const fallbackUsers = await listAllAuthUsers(adminClient)
  return fallbackUsers.filter(user => {
    const createdAt = user.created_at ? new Date(user.created_at).getTime() : Number.NaN
    if (Number.isNaN(createdAt)) return false
    return createdAt >= new Date(startIso).getTime() && createdAt < new Date(endIso).getTime()
  })
}

function isConfirmedAuthUser(user: AuthUserRow) {
  return Boolean(user.email_confirmed_at)
}

function filterReportableAuthUsers(authUsers: AuthUserRow[], profiledAuthUserIds: Set<string>) {
  return authUsers.filter(user => isConfirmedAuthUser(user) || profiledAuthUserIds.has(user.id))
}

async function loadExportProfiles(adminClient: AdminClient, authUserIds: string[]) {
  return loadChunkedRows(authUserIds, 250, async chunkValues => {
    const response = await adminClient
      .from('hid_user_profiles')
      .select('id, auth_user_id, app_role, display_name, active, deleted_at, deleted_reason, mfa_required, created_at, restored_at, updated_at')
      .in('auth_user_id', chunkValues)

    if (response.error) {
      throw new HttpError(400, response.error.message, response.error)
    }

    return (response.data ?? []) as ProfileRow[]
  })
}

async function loadExportPatients(adminClient: AdminClient, authUserIds: string[]) {
  return loadChunkedRows(authUserIds, 250, async chunkValues => {
    const response = await adminClient
      .from('hid_patients')
      .select('id, auth_user_id, user_profile_id, hid_code, first_name, last_name, full_name, email, phone_e164, gender, dob, blood_group, genotype, country, state, allergies, chronic_conditions, current_medications, hospital_currently_using, hmo_organization, photo_url, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, emergency_contact_address, medical_notes, nin_last4, profile_percent, notifications_enabled, created_at, deleted_at, deleted_reason, restored_at, updated_at')
      .in('auth_user_id', chunkValues)

    if (response.error) {
      throw new HttpError(400, response.error.message, response.error)
    }

    return (response.data ?? []) as PatientRow[]
  })
}

async function loadExportStaff(adminClient: AdminClient, authUserIds: string[]) {
  return loadChunkedRows(authUserIds, 250, async chunkValues => {
    const response = await adminClient
      .from('hid_staff_accounts')
      .select('id, auth_user_id, user_profile_id, full_name, email, phone_e164, hospital_name, verification_status, license_number, role, active, created_at, deleted_at, deleted_reason, restored_at, updated_at')
      .in('auth_user_id', chunkValues)

    if (response.error) {
      throw new HttpError(400, response.error.message, response.error)
    }

    return (response.data ?? []) as StaffRow[]
  })
}

async function loadExportMemberships(adminClient: AdminClient, staffIds: string[]) {
  return loadChunkedRows(staffIds, 250, async chunkValues => {
    const response = await adminClient
      .from('hid_staff_memberships')
      .select('id, staff_account_id, membership_role, app_role, is_primary, active, created_at')
      .in('staff_account_id', chunkValues)

    if (response.error) {
      throw new HttpError(400, response.error.message, response.error)
    }

    return (response.data ?? []) as MembershipRow[]
  })
}

async function loadExportMedicalRecords(adminClient: AdminClient, patientIds: string[]) {
  return loadChunkedRows(patientIds, 250, async chunkValues => {
    const response = await adminClient
      .from('hid_medical_records')
      .select('id, patient_id, title, category, current_version_id, created_at, updated_at')
      .in('patient_id', chunkValues)

    if (response.error) {
      throw new HttpError(400, response.error.message, response.error)
    }

    return (response.data ?? []) as MedicalRecordRow[]
  })
}

async function loadExportMedicalRecordVersions(adminClient: AdminClient, versionIds: string[]) {
  return loadChunkedRows(versionIds, 250, async chunkValues => {
    const response = await adminClient
      .from('hid_medical_record_versions')
      .select('id, record_id, version_no, record, notes, transcription_text, created_at')
      .in('id', chunkValues)

    if (response.error) {
      throw new HttpError(400, response.error.message, response.error)
    }

    return (response.data ?? []) as MedicalRecordVersionRow[]
  })
}

async function loadExportMedicalRecordFiles(adminClient: AdminClient, recordIds: string[]) {
  return loadChunkedRows(recordIds, 250, async chunkValues => {
    const response = await adminClient
      .from('hid_medical_record_files')
      .select('record_id, patient_id, original_file_name, mime_type, size_bytes, created_at')
      .in('record_id', chunkValues)

    if (response.error) {
      throw new HttpError(400, response.error.message, response.error)
    }

    return (response.data ?? []) as MedicalRecordFileRow[]
  })
}

async function loadExportSummaries(
  adminClient: AdminClient,
  profileIds: string[],
  patientIds: string[],
) {
  const rows: ExportSummaryRow[] = []
  const pageSize = 250
  const totalPages = Math.max(
    Math.ceil(profileIds.length / pageSize),
    Math.ceil(patientIds.length / pageSize),
  )

  for (let page = 0; page < totalPages; page += 1) {
    const response = await adminClient.rpc('hid_admin_export_user_summaries', {
      p_patient_ids: patientIds.slice(page * pageSize, (page + 1) * pageSize),
      p_profile_ids: profileIds.slice(page * pageSize, (page + 1) * pageSize),
    })

    if (response.error) {
      throw new HttpError(400, response.error.message, response.error)
    }

    rows.push(...((response.data ?? []) as ExportSummaryRow[]))
  }

  return rows
}

function summaryCount(value: number | string | null | undefined) {
  return value === null || value === undefined ? '0' : String(value)
}

function buildMedicalRecordDetails(
  records: MedicalRecordRow[],
  versions: MedicalRecordVersionRow[],
) {
  const versionsById = new Map(versions.map(version => [version.id, version]))
  const detailsByPatientId = new Map<string, string>()
  const recordsByPatientId = new Map<string, MedicalRecordRow[]>()

  for (const record of records) {
    const current = recordsByPatientId.get(record.patient_id) ?? []
    current.push(record)
    recordsByPatientId.set(record.patient_id, current)
  }

  for (const [patientId, patientRecords] of recordsByPatientId) {
    const details = patientRecords
      .slice()
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map(record => {
        const version = record.current_version_id ? versionsById.get(record.current_version_id) ?? null : null
        const lines = [
          `Title: ${record.title}`,
          `Category: ${record.category}`,
          `Created At: ${toAsciiTimestamp(record.created_at)}`,
          `Updated At: ${toAsciiTimestamp(record.updated_at)}`,
        ]

        if (version) {
          lines.push(`Version: ${version.version_no}`)
          lines.push(`Version Created At: ${toAsciiTimestamp(version.created_at)}`)
          lines.push(`Record: ${version.record}`)
          if (version.notes) lines.push(`Notes: ${version.notes}`)
          if (version.transcription_text) lines.push(`Transcription: ${version.transcription_text}`)
        }

        return lines.join('\n')
      })

    detailsByPatientId.set(patientId, details.join('\n\n---\n\n'))
  }

  return detailsByPatientId
}

function buildMedicalRecordFileDetails(files: MedicalRecordFileRow[]) {
  const detailsByPatientId = new Map<string, string[]>()

  for (const file of files) {
    const details = detailsByPatientId.get(file.patient_id) ?? []
    details.push([
      `Name: ${file.original_file_name}`,
      `Type: ${file.mime_type ?? 'unknown'}`,
      `Size Bytes: ${summaryCount(file.size_bytes)}`,
      `Uploaded At: ${toAsciiTimestamp(file.created_at)}`,
    ].join(' | '))
    detailsByPatientId.set(file.patient_id, details)
  }

  return new Map([...detailsByPatientId].map(([patientId, details]) => [patientId, details.join('\n')]))
}

function buildExportRows(
  authUsers: AuthUserRow[],
  profiles: ProfileRow[],
  patients: PatientRow[],
  staff: StaffRow[],
  memberships: MembershipRow[],
  summaries: ExportSummaryRow[],
  medicalRecordDetailsByPatientId: Map<string, string>,
  medicalRecordFileDetailsByPatientId: Map<string, string>,
) {
  const profilesByAuthId = new Map(profiles.map(profile => [profile.auth_user_id, profile]))
  const patientsByAuthId = new Map(patients.map(patient => [patient.auth_user_id, patient]))
  const staffByAuthId = new Map(staff.map(item => [item.auth_user_id, item]))
  const membershipsByStaffId = new Map<string, MembershipRow[]>()
  const profileNotificationCounts = new Map<string, string>()
  const patientSummaries = new Map<string, ExportSummaryRow>()

  for (const summary of summaries) {
    if (summary.profile_id) {
      profileNotificationCounts.set(summary.profile_id, summaryCount(summary.notification_count))
    }
    if (summary.patient_id) {
      patientSummaries.set(summary.patient_id, summary)
    }
  }

  for (const membership of memberships) {
    const current = membershipsByStaffId.get(membership.staff_account_id) ?? []
    current.push(membership)
    membershipsByStaffId.set(membership.staff_account_id, current)
  }

  return authUsers
    .slice()
    .sort((left, right) => {
      const leftTime = new Date(left.created_at ?? 0).getTime()
      const rightTime = new Date(right.created_at ?? 0).getTime()
      return rightTime - leftTime
    })
    .map(authUser => {
      const profile = profilesByAuthId.get(authUser.id) ?? null
      const patient = patientsByAuthId.get(authUser.id) ?? null
      const staffAccount = staffByAuthId.get(authUser.id) ?? null
      const patientSummary = patient ? patientSummaries.get(patient.id) ?? null : null
      const staffMemberships = staffAccount ? (membershipsByStaffId.get(staffAccount.id) ?? []) : []
      const activeMembershipCount = staffMemberships.filter(item => item.active).length
      const inactiveMembershipCount = staffMemberships.length - activeMembershipCount
      const deleted = Boolean(profile?.deleted_at || patient?.deleted_at || staffAccount?.deleted_at)
      const locked = deleted ? false : profile ? !profile.active : false
      const restrictable = Boolean(staffAccount) && !deleted
      const restorable = deleted
      const staffAccessRestricted = staffAccount ? (!deleted && (!staffAccount.active || activeMembershipCount === 0)) : null
      const accountStatus = deleted ? 'deleted' : locked ? 'locked' : 'active'

      return {
        accountStatus,
        authCreatedAt: toAsciiTimestamp(authUser.created_at),
        authUserId: authUser.id,
        email: normalizeText(authUser.email),
        emailConfirmedAt: toAsciiTimestamp(authUser.email_confirmed_at),
        flagsDeleted: normalizeText(deleted),
        flagsLocked: normalizeText(locked),
        flagsRestorable: normalizeText(restorable),
        flagsRestrictable: normalizeText(restrictable),
        flagsStaffAccessRestricted: normalizeText(staffAccessRestricted),
        lastSignInAt: toAsciiTimestamp(authUser.last_sign_in_at),
        patientCountry: normalizeText(patient?.country),
        patientCreatedAt: toAsciiTimestamp(patient?.created_at),
        patientCurrentMedications: normalizeText(patient?.current_medications),
        patientDeletedAt: toAsciiTimestamp(patient?.deleted_at),
        patientDeletedReason: normalizeText(patient?.deleted_reason),
        patientDob: normalizeText(patient?.dob),
        patientEmail: normalizeText(patient?.email),
        patientEmergencyContactAddress: normalizeText(patient?.emergency_contact_address),
        patientEmergencyContactName: normalizeText(patient?.emergency_contact_name),
        patientEmergencyContactPhone: normalizeText(patient?.emergency_contact_phone),
        patientEmergencyContactRelationship: normalizeText(patient?.emergency_contact_relationship),
        patientFirstName: normalizeText(patient?.first_name),
        patientFullName: normalizeText(patient?.full_name),
        patientGender: normalizeText(patient?.gender),
        patientGenotype: normalizeText(patient?.genotype),
        patientHealthEventCount: summaryCount(patientSummary?.health_event_count),
        patientHmoOrganization: normalizeText(patient?.hmo_organization),
        patientHospitalCurrentlyUsing: normalizeText(patient?.hospital_currently_using),
        patientHidCode: normalizeText(patient?.hid_code),
        patientId: normalizeText(patient?.id),
        patientMedicalNotes: normalizeText(patient?.medical_notes),
        patientMedicalRecordCount: summaryCount(patientSummary?.medical_record_count),
        patientMedicalRecordDetails: patient ? (medicalRecordDetailsByPatientId.get(patient.id) ?? '') : '',
        patientMedicalRecordFileDetails: patient ? (medicalRecordFileDetailsByPatientId.get(patient.id) ?? '') : '',
        patientNinLast4: normalizeText(patient?.nin_last4),
        patientNotificationsEnabled: normalizeText(patient ? patient.notifications_enabled : null),
        patientPhotoUrl: normalizeText(patient?.photo_url),
        patientPhone: normalizeText(patient?.phone_e164),
        patientProfilePercent: normalizeText(patient?.profile_percent),
        patientRecordFileCount: summaryCount(patientSummary?.record_file_count),
        patientRecordFileStorageBytes: summaryCount(patientSummary?.record_file_storage_bytes),
        patientRestoredAt: normalizeText(patient?.restored_at),
        patientState: normalizeText(patient?.state),
        patientUpdatedAt: toAsciiTimestamp(patient?.updated_at),
        patientActiveAccessGrantCount: summaryCount(patientSummary?.active_access_grant_count),
        patientAllergies: normalizeText(patient?.allergies),
        patientBloodGroup: normalizeText(patient?.blood_group),
        patientChronicConditions: normalizeText(patient?.chronic_conditions),
        patientPendingAccessRequestCount: summaryCount(patientSummary?.pending_access_request_count),
        profileActive: normalizeText(profile?.active),
        profileAppRole: normalizeText(profile?.app_role),
        profileCreatedAt: toAsciiTimestamp(profile?.created_at),
        profileDeletedAt: toAsciiTimestamp(profile?.deleted_at),
        profileDeletedReason: normalizeText(profile?.deleted_reason),
        profileDisplayName: normalizeText(profile?.display_name),
        profileId: normalizeText(profile?.id),
        profileMfaRequired: normalizeText(profile?.mfa_required),
        profileNotificationCount: profile ? (profileNotificationCounts.get(profile.id) ?? '0') : '0',
        profileRestoredAt: normalizeText(profile?.restored_at),
        profileUpdatedAt: toAsciiTimestamp(profile?.updated_at),
        staffActive: normalizeText(staffAccount?.active),
        staffCreatedAt: toAsciiTimestamp(staffAccount?.created_at),
        staffDeletedAt: toAsciiTimestamp(staffAccount?.deleted_at),
        staffDeletedReason: normalizeText(staffAccount?.deleted_reason),
        staffEmail: normalizeText(staffAccount?.email),
        staffFullName: normalizeText(staffAccount?.full_name),
        staffHospitalName: normalizeText(staffAccount?.hospital_name),
        staffId: normalizeText(staffAccount?.id),
        staffInactiveMembershipCount: normalizeText(inactiveMembershipCount),
        staffLicenseNumber: normalizeText(staffAccount?.license_number),
        staffPhone: normalizeText(staffAccount?.phone_e164),
        staffMembershipCount: normalizeText(staffMemberships.length),
        staffRestoredAt: normalizeText(staffAccount?.restored_at),
        staffRole: normalizeText(staffAccount?.role),
        staffUpdatedAt: toAsciiTimestamp(staffAccount?.updated_at),
        staffVerificationStatus: normalizeText(staffAccount?.verification_status),
      } satisfies AdminUsersExportRow
    })
}

function isWithinDays(isoTimestamp: string, days: number) {
  const timestamp = new Date(isoTimestamp).getTime()
  if (Number.isNaN(timestamp)) return false
  const lowerBound = Date.now() - (days * 24 * 60 * 60 * 1000)
  return timestamp >= lowerBound
}

function matchesExportQuery(row: AdminUsersExportRow, query: string) {
  const normalized = normalizeSearchValue(query)
  if (!normalized) return true
  return [
    row.authUserId,
    row.email,
    row.patientEmail,
    row.patientEmergencyContactName,
    row.patientFullName,
    row.patientHidCode,
    row.patientPhone,
    row.profileAppRole,
    row.profileDisplayName,
    row.staffEmail,
    row.staffFullName,
    row.staffHospitalName,
    row.staffPhone,
    row.staffRole,
  ].some(value => normalizeSearchValue(value).includes(normalized))
}

function searchMatchesEmail(query: string) {
  return query.includes('@')
}

async function loadScopedAuthUsers(adminClient: AdminClient, filters: AdminUsersExportFilters) {
  if (filters.scope === 'selected_user' && filters.authUserId) {
    return getAuthUsersByIds(adminClient, [filters.authUserId])
  }

  if (filters.scope === 'search_results' && filters.query) {
    const trimmedQuery = filters.query.trim()
    const searchPattern = `%${trimmedQuery}%`
    const [patientResult, staffResult, authMatches] = await Promise.all([
      searchMatchesEmail(trimmedQuery)
        ? adminClient.from('hid_patients').select('auth_user_id').ilike('email', searchPattern).limit(20)
        : adminClient.from('hid_patients').select('auth_user_id').ilike('hid_code', searchPattern).limit(20),
      searchMatchesEmail(trimmedQuery)
        ? adminClient.from('hid_staff_accounts').select('auth_user_id').ilike('email', searchPattern).limit(20)
        : Promise.resolve({ data: [], error: null }),
      searchMatchesEmail(trimmedQuery)
        ? lookupAuthUsersByEmail(adminClient, trimmedQuery)
        : Promise.resolve(new Map<string, MatchedAuthUserRow>()),
    ])

    if (patientResult.error) throw new HttpError(400, patientResult.error.message, patientResult.error)
    if (staffResult.error) throw new HttpError(400, staffResult.error.message, staffResult.error)

    const authUserIds = unique([
      ...((patientResult.data ?? []) as Array<{ auth_user_id: string }>).map(item => item.auth_user_id),
      ...((staffResult.data ?? []) as Array<{ auth_user_id: string }>).map(item => item.auth_user_id),
      ...authMatches.keys(),
    ])

    return getAuthUsersByIds(adminClient, authUserIds)
  }

  if (filters.scope === 'selected_day' && filters.date) {
    const start = new Date(`${filters.date}T00:00:00.000Z`).toISOString()
    const end = new Date(new Date(`${filters.date}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString()
    return loadAuthUsersCreatedBetween(adminClient, start, end)
  }

  if (filters.scope === 'last_7_days') {
    const end = new Date()
    const start = new Date(end.getTime() - (7 * 24 * 60 * 60 * 1000))
    return loadAuthUsersCreatedBetween(adminClient, start.toISOString(), end.toISOString())
  }

  if (filters.scope === 'last_30_days') {
    const end = new Date()
    const start = new Date(end.getTime() - (30 * 24 * 60 * 60 * 1000))
    return loadAuthUsersCreatedBetween(adminClient, start.toISOString(), end.toISOString())
  }

  return listAllAuthUsers(adminClient)
}

function matchesExportDate(row: AdminUsersExportRow, filters: AdminUsersExportFilters) {
  if (filters.scope === 'selected_day' && filters.date) {
    return row.authCreatedAt.slice(0, 10) === filters.date
  }
  if (filters.scope === 'last_7_days') {
    return isWithinDays(row.authCreatedAt, 7)
  }
  if (filters.scope === 'last_30_days') {
    return isWithinDays(row.authCreatedAt, 30)
  }
  return true
}

function filterExportRows(rows: AdminUsersExportRow[], filters: AdminUsersExportFilters) {
  return rows.filter(row => {
    if (filters.scope === 'selected_user' && filters.authUserId) {
      return row.authUserId === filters.authUserId
    }
    if (filters.scope === 'search_results') {
      return matchesExportQuery(row, filters.query ?? '')
    }
    return matchesExportDate(row, filters)
  })
}

function formatTimestampForFileName(value = new Date()) {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  const hours = `${value.getHours()}`.padStart(2, '0')
  const minutes = `${value.getMinutes()}`.padStart(2, '0')
  const seconds = `${value.getSeconds()}`.padStart(2, '0')
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

function buildCsv(rows: AdminUsersExportRow[]) {
  const header = ADMIN_USERS_EXPORT_COLUMNS.join(',')
  const body = rows.map(row => ADMIN_USERS_EXPORT_COLUMNS
    .map(column => escapeCsv((row[column] ?? '').toString()))
    .join(',')
  )
  return [header, ...body].join('\n')
}

function exportColumnLabel(column: keyof AdminUsersExportRow) {
  return String(column)
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, value => value.toUpperCase())
}

function appendExportDetails(lines: string[], row: AdminUsersExportRow) {
  for (const column of ADMIN_USERS_EXPORT_COLUMNS) {
    lines.push(`${exportColumnLabel(column)}: ${displayValue(row[column])}`)
  }
}

function buildTxt(rows: AdminUsersExportRow[], generatedAt: string) {
  const lines: string[] = [
    'HID Admin Users Export',
    `Generated at: ${generatedAt}`,
    `Total users: ${rows.length}`,
    '',
  ]

  rows.forEach((row, index) => {
    lines.push(`User ${index + 1}`)
    appendExportDetails(lines, row)
    lines.push('')
  })

  return `${lines.join('\n')}\n`
}

function wrapText(value: string, maxWidth = 88) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ['']
  const words = normalized.split(' ')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxWidth) {
      if (current) lines.push(current)
      current = word
    } else {
      current = next
    }
  }

  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

function buildPdfLines(rows: AdminUsersExportRow[], generatedAt: string) {
  const lines: string[] = [
    'HID Admin Users Export',
    `Generated at: ${generatedAt}`,
    `Total users: ${rows.length}`,
    '',
  ]

  rows.forEach((row, index) => {
    const block: string[] = [`User ${index + 1}`]
    appendExportDetails(block, row)
    block.push('')

    block.forEach(line => {
      wrapText(line).forEach(wrapped => lines.push(wrapped))
    })
  })

  return lines
}

function buildCsvXlsxSheet(rows: AdminUsersExportRow[]) {
  const sheetRows = [
    ADMIN_USERS_EXPORT_COLUMNS.map(column => String(column)),
    ...rows.map(row => ADMIN_USERS_EXPORT_COLUMNS.map(column => row[column] ?? '')),
  ]

  const columnLetters = (index: number) => {
    let value = index + 1
    let letters = ''
    while (value > 0) {
      const remainder = (value - 1) % 26
      letters = String.fromCharCode(65 + remainder) + letters
      value = Math.floor((value - remainder - 1) / 26)
    }
    return letters
  }

  const rowsXml = sheetRows.map((cells, rowIndex) => {
    const rowNumber = rowIndex + 1
    const cellsXml = cells.map((cell, cellIndex) => {
      const cellRef = `${columnLetters(cellIndex)}${rowNumber}`
      return `<c r="${cellRef}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`
    }).join('')
    return `<row r="${rowNumber}">${cellsXml}</row>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData>${rowsXml}</sheetData>
</worksheet>`
}

function buildXlsx(rows: AdminUsersExportRow[], generatedAt: string) {
  const sheetXml = buildCsvXlsxSheet(rows)
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Users" sheetId="1" r:id="rId1" />
  </sheets>
</workbook>`
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml" />
</Relationships>`
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" />
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml" />
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml" />
</Relationships>`
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml" />
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml" />
</Types>`
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>HID Admin Users Export</dc:title>
  <dc:creator>HID</dc:creator>
  <cp:lastModifiedBy>HID</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:modified>
</cp:coreProperties>`
  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>HID</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>1</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="1" baseType="lpstr">
      <vt:lpstr>Users</vt:lpstr>
    </vt:vector>
  </TitlesOfParts>
  <Company>HID Technologies</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0300</AppVersion>
</Properties>`

  const files = [
    { path: '[Content_Types].xml', content: contentTypesXml },
    { path: '_rels/.rels', content: relsXml },
    { path: 'docProps/app.xml', content: appXml },
    { path: 'docProps/core.xml', content: coreXml },
    { path: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { path: 'xl/workbook.xml', content: workbookXml },
    { path: 'xl/worksheets/sheet1.xml', content: sheetXml },
  ]

  return buildZip(files)
}

function buildPdf(rows: AdminUsersExportRow[], generatedAt: string) {
  const lines = buildPdfLines(rows, generatedAt)
  const perPage = 46
  const pages: string[][] = []
  for (let index = 0; index < lines.length; index += perPage) {
    pages.push(lines.slice(index, index + perPage))
  }

  const encoder = new TextEncoder()
  const objectContents: string[] = []
  const pageContentNumbers: number[] = []
  const pageObjectNumbers: number[] = []

  let nextObjectNumber = 4
  for (let index = 0; index < pages.length; index += 1) {
    pageContentNumbers.push(nextObjectNumber)
    nextObjectNumber += 1
    pageObjectNumbers.push(nextObjectNumber)
    nextObjectNumber += 1
  }

  objectContents[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objectContents[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map(pageNumber => `${pageNumber} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objectContents[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

  pages.forEach((pageLines, pageIndex) => {
    const contentLines: string[] = []
    contentLines.push('BT')
    contentLines.push('/F1 10 Tf')
    contentLines.push('50 770 Td')

    pageLines.forEach((line, lineIndex) => {
      const safe = escapePdfText(line)
      contentLines.push(`(${safe}) Tj`)
      if (lineIndex !== pageLines.length - 1) {
        contentLines.push('0 -13 Td')
      }
    })
    contentLines.push('ET')

    const content = contentLines.join('\n')
    const contentNumber = pageContentNumbers[pageIndex]
    const pageNumber = pageObjectNumbers[pageIndex]
    objectContents[contentNumber] = `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`
    objectContents[pageNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`
  })

  const chunks: Uint8Array[] = []
  const header = encoder.encode('%PDF-1.4\n%\u00FF\u00FF\u00FF\u00FF\n')
  chunks.push(header)

  const offsets: number[] = [0]
  let byteOffset = header.length

  for (let objectNumber = 1; objectNumber < objectContents.length; objectNumber += 1) {
    const content = objectContents[objectNumber]
    if (!content) continue
    offsets[objectNumber] = byteOffset
    const objectBytes = encoder.encode(`${objectNumber} 0 obj\n${content}\nendobj\n`)
    chunks.push(objectBytes)
    byteOffset += objectBytes.length
  }

  const xrefOffset = byteOffset
  const xrefLines = [
    'xref',
    `0 ${objectContents.length}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map(offset => `${`${offset}`.padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objectContents.length} /Root 1 0 R >>`,
    'startxref',
    `${xrefOffset}`,
    '%%EOF',
  ].join('\n')

  chunks.push(encoder.encode(xrefLines))
  return concatBytes(chunks)
}

function crc32(bytes: Uint8Array) {
  const table = crc32Table()
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

let crc32Cache: Uint32Array | null = null
function crc32Table() {
  if (crc32Cache) return crc32Cache
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c >>> 0
  }
  crc32Cache = table
  return table
}

function dosDateTime(now = new Date()) {
  const year = Math.max(1980, now.getFullYear())
  const date = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  return { date, time }
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function writeUint16LE(value: number) {
  const bytes = new Uint8Array(2)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, value, true)
  return bytes
}

function writeUint32LE(value: number) {
  const bytes = new Uint8Array(4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, value >>> 0, true)
  return bytes
}

function buildZip(files: Array<{ content: string; path: string }>) {
  const encoder = new TextEncoder()
  const fileChunks: Uint8Array[] = []
  const centralDirectoryChunks: Uint8Array[] = []
  let localOffset = 0
  const { date, time } = dosDateTime()

  for (const file of files) {
    const nameBytes = encoder.encode(file.path)
    const contentBytes = encoder.encode(file.content)
    const crc = crc32(contentBytes)
    const localHeader = concatBytes([
      writeUint32LE(0x04034b50),
      writeUint16LE(20),
      writeUint16LE(0),
      writeUint16LE(0),
      writeUint16LE(time),
      writeUint16LE(date),
      writeUint32LE(crc),
      writeUint32LE(contentBytes.length),
      writeUint32LE(contentBytes.length),
      writeUint16LE(nameBytes.length),
      writeUint16LE(0),
      nameBytes,
      contentBytes,
    ])
    fileChunks.push(localHeader)

    const centralHeader = concatBytes([
      writeUint32LE(0x02014b50),
      writeUint16LE(20),
      writeUint16LE(20),
      writeUint16LE(0),
      writeUint16LE(0),
      writeUint16LE(time),
      writeUint16LE(date),
      writeUint32LE(crc),
      writeUint32LE(contentBytes.length),
      writeUint32LE(contentBytes.length),
      writeUint16LE(nameBytes.length),
      writeUint16LE(0),
      writeUint16LE(0),
      writeUint16LE(0),
      writeUint16LE(0),
      writeUint32LE(0),
      writeUint32LE(localOffset),
      nameBytes,
    ])
    centralDirectoryChunks.push(centralHeader)
    localOffset += localHeader.length
  }

  const centralDirectory = concatBytes(centralDirectoryChunks)
  const endOfCentralDirectory = concatBytes([
    writeUint32LE(0x06054b50),
    writeUint16LE(0),
    writeUint16LE(0),
    writeUint16LE(files.length),
    writeUint16LE(files.length),
    writeUint32LE(centralDirectory.length),
    writeUint32LE(fileChunks.reduce((sum, chunk) => sum + chunk.length, 0)),
    writeUint16LE(0),
  ])

  return concatBytes([...fileChunks, centralDirectory, endOfCentralDirectory])
}

export async function loadAdminUsersExportRows(adminClient: AdminClient, filters: AdminUsersExportFilters) {
  const scopedAuthUsers = await loadScopedAuthUsers(adminClient, filters)
  const authUserIds = unique(scopedAuthUsers.map(user => user.id))
  const [profiles, patients, staff] = await Promise.all([
    loadExportProfiles(adminClient, authUserIds),
    loadExportPatients(adminClient, authUserIds),
    loadExportStaff(adminClient, authUserIds),
  ])
  const profiledAuthUserIds = new Set<string>([
    ...profiles.map(profile => profile.auth_user_id),
    ...patients.map(patient => patient.auth_user_id),
    ...staff.map(item => item.auth_user_id),
  ])
  const authUsers = filterReportableAuthUsers(scopedAuthUsers, profiledAuthUserIds)
  const reportableAuthUserIds = new Set(authUsers.map(user => user.id))
  const reportableProfiles = profiles.filter(profile => reportableAuthUserIds.has(profile.auth_user_id))
  const reportablePatients = patients.filter(patient => reportableAuthUserIds.has(patient.auth_user_id))
  const reportableStaff = staff.filter(account => reportableAuthUserIds.has(account.auth_user_id))
  const reportableStaffIds = unique(reportableStaff.map(account => account.id))
  const medicalRecords = await loadExportMedicalRecords(
    adminClient,
    unique(reportablePatients.map(patient => patient.id)),
  )
  const medicalRecordIds = unique(medicalRecords.map(record => record.id))
  const medicalRecordVersionIds = unique(
    medicalRecords
      .map(record => record.current_version_id)
      .filter((versionId): versionId is string => Boolean(versionId)),
  )
  const [memberships, summaries, medicalRecordVersions, medicalRecordFiles] = await Promise.all([
    reportableStaffIds.length > 0 ? loadExportMemberships(adminClient, reportableStaffIds) : Promise.resolve([] as MembershipRow[]),
    loadExportSummaries(
      adminClient,
      unique(reportableProfiles.map(profile => profile.id)),
      unique(reportablePatients.map(patient => patient.id)),
    ),
    loadExportMedicalRecordVersions(adminClient, medicalRecordVersionIds),
    loadExportMedicalRecordFiles(adminClient, medicalRecordIds),
  ])
  const rows = buildExportRows(
    authUsers,
    reportableProfiles,
    reportablePatients,
    reportableStaff,
    memberships,
    summaries,
    buildMedicalRecordDetails(medicalRecords, medicalRecordVersions),
    buildMedicalRecordFileDetails(medicalRecordFiles),
  )
  const filteredRows = filterExportRows(rows, filters)
  if (filteredRows.length === 0) {
    throw new HttpError(404, 'No users matched the selected export criteria.')
  }
  return filteredRows
}

export async function buildAdminUsersExportFile(rows: AdminUsersExportRow[], format: AdminUsersExportFormat) {
  const generatedAt = new Date().toISOString()
  const fileNameBase = `hid-users-export-${formatTimestampForFileName(new Date())}`

  if (format === 'csv') {
    return {
      bytes: new TextEncoder().encode(buildCsv(rows)),
      contentType: 'text/csv; charset=utf-8',
      fileName: `${fileNameBase}.csv`,
    } satisfies AdminUsersExportFile
  }

  if (format === 'txt') {
    return {
      bytes: new TextEncoder().encode(buildTxt(rows, generatedAt)),
      contentType: 'text/plain; charset=utf-8',
      fileName: `${fileNameBase}.txt`,
    } satisfies AdminUsersExportFile
  }

  if (format === 'pdf') {
    return {
      bytes: buildPdf(rows, generatedAt),
      contentType: 'application/pdf',
      fileName: `${fileNameBase}.pdf`,
    } satisfies AdminUsersExportFile
  }

  return {
    bytes: buildXlsx(rows, generatedAt),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `${fileNameBase}.xlsx`,
  } satisfies AdminUsersExportFile
}
