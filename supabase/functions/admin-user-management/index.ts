import { createAdminClient, requireRole } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asTrimmedString } from '../_shared/validation.ts'

const USER_LIST_PAGE_SIZE = 200
const LOCK_BAN_DURATION = '876000h'

type AdminUserManagementAction =
  | 'lock_profile'
  | 'unlock_profile'
  | 'restrict_staff_access'
  | 'restore_staff_access'
  | 'close_patient_access'
  | 'restore_account'
  | 'delete_account'

type SearchPayload = {
  action?: AdminUserManagementAction
  targetAuthUserId?: string
}

type ProfileRow = {
  id: string
  auth_user_id: string
  app_role: string
  display_name: string | null
  active: boolean
  deleted_at: string | null
  deleted_reason: string | null
  deleted_by_user_profile_id: string | null
  mfa_required: boolean
  created_at: string
  restored_at: string | null
  restored_by_user_profile_id: string | null
  updated_at: string
}

type PatientRow = {
  id: string
  auth_user_id: string
  user_profile_id: string
  hid_code: string
  full_name: string
  email: string | null
  phone_e164: string | null
  gender: string | null
  dob: string | null
  country: string | null
  state: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  profile_percent: number
  notifications_enabled: boolean
  created_at: string
  deleted_at: string | null
  deleted_reason: string | null
  restored_at: string | null
  updated_at: string
}

type StaffRow = {
  id: string
  auth_user_id: string
  user_profile_id: string
  full_name: string
  email: string
  phone_e164: string | null
  hospital_name: string | null
  verification_status: string
  license_number: string | null
  role: string
  active: boolean
  created_at: string
  deleted_at: string | null
  deleted_reason: string | null
  restored_at: string | null
  updated_at: string
}

type MembershipRow = {
  id: string
  staff_account_id: string
  organization_id: string
  membership_role: string
  app_role: string
  is_primary: boolean
  active: boolean
  created_at: string
}

type OrganizationRow = {
  id: string
  name: string
}

type NotificationCountRow = {
  user_profile_id: string
}

type RecordCountRow = {
  patient_id: string
}

type AccessGrantByPatientRow = {
  patient_id: string
}

type AccessGrantByStaffRow = {
  staff_account_id: string
}

type AccessRequestByPatientRow = {
  patient_id: string
}

type AccessRequestByStaffRow = {
  requester_staff_account_id: string
}

type ActiveGrantRow = {
  id: string
  patient_id: string
  staff_account_id: string
}

type PendingRequestRow = {
  id: string
  patient_id: string
  requester_staff_account_id: string
}

type StaffProfileRow = {
  id: string
  user_profile_id: string
}

type MatchedAuthUser = {
  email: string | null
  emailConfirmedAt: string | null
  id: string
  lastSignInAt: string | null
}

type ManagedUser = {
  id: string
  email: string | null
  emailConfirmedAt: string | null
  lastSignInAt: string | null
  profile: {
    id: string
    authUserId: string
    appRole: string | null
    displayName: string | null
    active: boolean
    deletedAt: string | null
    deletedByUserProfileId: string | null
    deletedReason: string | null
    mfaRequired: boolean
    createdAt: string
    restoredAt: string | null
    restoredByUserProfileId: string | null
    updatedAt: string
  } | null
  patient: {
    id: string
    authUserId: string
    userProfileId: string
    hidCode: string
    fullName: string
    email: string | null
    phone: string | null
    gender: string | null
    dateOfBirth: string | null
    country: string | null
    state: string | null
    emergencyContactName: string | null
    emergencyContactPhone: string | null
    profilePercent: number
    notificationsEnabled: boolean
    createdAt: string
    updatedAt: string
  } | null
  staff: {
    id: string
    authUserId: string
    userProfileId: string
    fullName: string
    email: string
    phone: string | null
    hospitalName: string | null
    verificationStatus: string
    licenseNumber: string | null
    role: string
    active: boolean
    createdAt: string
    updatedAt: string
    memberships: Array<{
      id: string
      organizationId: string
      organizationName: string | null
      membershipRole: string
      appRole: string
      isPrimary: boolean
      active: boolean
      createdAt: string
    }>
    activeMembershipCount: number
    inactiveMembershipCount: number
  } | null
  stats: {
    activeGrantCount: number
    pendingRequestCount: number
    recordCount: number
    unreadNotificationCount: number
  }
  flags: {
    deleted: boolean
    locked: boolean
    deletable: boolean
    lockable: boolean
    patientAccessOpen: boolean | null
    restrictable: boolean
    restorable: boolean
    staffAccessRestricted: boolean | null
  }
}

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

function countByKey<T extends string>(rows: Array<Record<T, string>>, key: T) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = row[key]
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

async function lookupAuthUsersByEmail(adminClient: ReturnType<typeof createAdminClient>, query: string) {
  const matches = new Map<string, MatchedAuthUser>()
  const { data, error } = await adminClient.rpc('hid_admin_auth_user_search', {
    p_limit: Math.min(USER_LIST_PAGE_SIZE, 20),
    p_query: query,
  })

  if (error) throw new HttpError(400, error.message, error)

  for (const row of ((data ?? []) as Array<Record<string, unknown>>)) {
    const authUserId = `${row.auth_user_id ?? ''}`.trim()
    if (!authUserId) continue
    matches.set(authUserId, {
      id: authUserId,
      email: typeof row.email === 'string' ? row.email : null,
      emailConfirmedAt: typeof row.email_confirmed_at === 'string' ? row.email_confirmed_at : null,
      lastSignInAt: typeof row.last_sign_in_at === 'string' ? row.last_sign_in_at : null,
    })
  }

  return matches
}

async function getAuthUsersByIds(
  adminClient: ReturnType<typeof createAdminClient>,
  authUserIds: string[],
  seed = new Map<string, MatchedAuthUser>(),
) {
  const matches = new Map(seed)

  await Promise.all(authUserIds.map(async authUserId => {
    if (matches.has(authUserId)) return
    const { data, error } = await adminClient.auth.admin.getUserById(authUserId)
    if (error) throw new HttpError(400, error.message, error)
    const user = data.user
    matches.set(authUserId, {
      id: authUserId,
      email: user?.email ?? null,
      emailConfirmedAt: user?.email_confirmed_at ?? null,
      lastSignInAt: user?.last_sign_in_at ?? null,
    })
  }))

  return matches
}

async function loadManagedUsersByAuthIds(
  adminClient: ReturnType<typeof createAdminClient>,
  authUserIds: string[],
  authUserSeed = new Map<string, MatchedAuthUser>(),
): Promise<ManagedUser[]> {
  const uniqueAuthUserIds = unique(authUserIds).filter(Boolean)
  if (uniqueAuthUserIds.length === 0) return []

  const [profilesResult, patientsResult, staffResult, authUsers] = await Promise.all([
    adminClient
      .from('hid_user_profiles')
      .select('id, auth_user_id, app_role, display_name, active, deleted_at, deleted_reason, deleted_by_user_profile_id, mfa_required, created_at, restored_at, restored_by_user_profile_id, updated_at')
      .in('auth_user_id', uniqueAuthUserIds),
    adminClient
      .from('hid_patients')
      .select('id, auth_user_id, user_profile_id, hid_code, full_name, email, phone_e164, gender, dob, country, state, emergency_contact_name, emergency_contact_phone, profile_percent, notifications_enabled, created_at, deleted_at, deleted_reason, restored_at, updated_at')
      .in('auth_user_id', uniqueAuthUserIds),
    adminClient
      .from('hid_staff_accounts')
      .select('id, auth_user_id, user_profile_id, full_name, email, phone_e164, hospital_name, verification_status, license_number, role, active, created_at, deleted_at, deleted_reason, restored_at, updated_at')
      .in('auth_user_id', uniqueAuthUserIds),
    getAuthUsersByIds(adminClient, uniqueAuthUserIds, authUserSeed),
  ])

  if (profilesResult.error) throw new HttpError(400, profilesResult.error.message, profilesResult.error)
  if (patientsResult.error) throw new HttpError(400, patientsResult.error.message, patientsResult.error)
  if (staffResult.error) throw new HttpError(400, staffResult.error.message, staffResult.error)

  const profiles = (profilesResult.data ?? []) as ProfileRow[]
  const patients = (patientsResult.data ?? []) as PatientRow[]
  const staffAccounts = (staffResult.data ?? []) as StaffRow[]

  const patientIds = patients.map(item => item.id)
  const staffIds = staffAccounts.map(item => item.id)
  const profileIds = profiles.map(item => item.id)

  const [membershipsResult, unreadNotificationsResult, recordCountsResult, activePatientGrantsResult, activeStaffGrantsResult, pendingPatientRequestsResult, pendingStaffRequestsResult] = await Promise.all([
    staffIds.length > 0
      ? adminClient
          .from('hid_staff_memberships')
          .select('id, staff_account_id, organization_id, membership_role, app_role, is_primary, active, created_at')
          .in('staff_account_id', staffIds)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length > 0
      ? adminClient
          .from('hid_notifications')
          .select('user_profile_id')
          .in('user_profile_id', profileIds)
          .is('read_at', null)
      : Promise.resolve({ data: [], error: null }),
    patientIds.length > 0
      ? adminClient
          .from('hid_medical_records')
          .select('patient_id')
          .in('patient_id', patientIds)
      : Promise.resolve({ data: [], error: null }),
    patientIds.length > 0
      ? adminClient
          .from('hid_access_grants')
          .select('patient_id')
          .in('patient_id', patientIds)
          .eq('status', 'active')
      : Promise.resolve({ data: [], error: null }),
    staffIds.length > 0
      ? adminClient
          .from('hid_access_grants')
          .select('staff_account_id')
          .in('staff_account_id', staffIds)
          .eq('status', 'active')
      : Promise.resolve({ data: [], error: null }),
    patientIds.length > 0
      ? adminClient
          .from('hid_access_requests')
          .select('patient_id')
          .in('patient_id', patientIds)
          .eq('status', 'pending')
      : Promise.resolve({ data: [], error: null }),
    staffIds.length > 0
      ? adminClient
          .from('hid_access_requests')
          .select('requester_staff_account_id')
          .in('requester_staff_account_id', staffIds)
          .eq('status', 'pending')
      : Promise.resolve({ data: [], error: null }),
  ])

  if (membershipsResult.error) throw new HttpError(400, membershipsResult.error.message, membershipsResult.error)
  if (unreadNotificationsResult.error) throw new HttpError(400, unreadNotificationsResult.error.message, unreadNotificationsResult.error)
  if (recordCountsResult.error) throw new HttpError(400, recordCountsResult.error.message, recordCountsResult.error)
  if (activePatientGrantsResult.error) throw new HttpError(400, activePatientGrantsResult.error.message, activePatientGrantsResult.error)
  if (activeStaffGrantsResult.error) throw new HttpError(400, activeStaffGrantsResult.error.message, activeStaffGrantsResult.error)
  if (pendingPatientRequestsResult.error) throw new HttpError(400, pendingPatientRequestsResult.error.message, pendingPatientRequestsResult.error)
  if (pendingStaffRequestsResult.error) throw new HttpError(400, pendingStaffRequestsResult.error.message, pendingStaffRequestsResult.error)

  const memberships = (membershipsResult.data ?? []) as MembershipRow[]
  const organizationIds = unique(memberships.map(item => item.organization_id))
  const organizationsResult = organizationIds.length > 0
    ? await adminClient
        .from('hid_organizations')
        .select('id, name')
        .in('id', organizationIds)
    : { data: [], error: null }

  if (organizationsResult.error) throw new HttpError(400, organizationsResult.error.message, organizationsResult.error)

  const organizations = (organizationsResult.data ?? []) as OrganizationRow[]

  const profilesByAuth = new Map(profiles.map(item => [item.auth_user_id, item]))
  const patientsByAuth = new Map(patients.map(item => [item.auth_user_id, item]))
  const staffByAuth = new Map(staffAccounts.map(item => [item.auth_user_id, item]))
  const orgsById = new Map(organizations.map(item => [item.id, item.name]))
  const membershipsByStaff = new Map<string, MembershipRow[]>()

  for (const membership of memberships) {
    const current = membershipsByStaff.get(membership.staff_account_id) ?? []
    current.push(membership)
    membershipsByStaff.set(membership.staff_account_id, current)
  }

  const unreadByProfile = countByKey((unreadNotificationsResult.data ?? []) as NotificationCountRow[], 'user_profile_id')
  const recordsByPatient = countByKey((recordCountsResult.data ?? []) as RecordCountRow[], 'patient_id')
  const activePatientGrantsByPatient = countByKey((activePatientGrantsResult.data ?? []) as AccessGrantByPatientRow[], 'patient_id')
  const activeStaffGrantsByStaff = countByKey((activeStaffGrantsResult.data ?? []) as AccessGrantByStaffRow[], 'staff_account_id')
  const pendingPatientRequestsByPatient = countByKey((pendingPatientRequestsResult.data ?? []) as AccessRequestByPatientRow[], 'patient_id')
  const pendingStaffRequestsByStaff = countByKey((pendingStaffRequestsResult.data ?? []) as AccessRequestByStaffRow[], 'requester_staff_account_id')

  return uniqueAuthUserIds.map(authUserId => {
    const authUser = authUsers.get(authUserId) ?? {
      id: authUserId,
      email: null,
      emailConfirmedAt: null,
      lastSignInAt: null,
    }
    const profile = profilesByAuth.get(authUserId) ?? null
    const patient = patientsByAuth.get(authUserId) ?? null
    const staff = staffByAuth.get(authUserId) ?? null
    const staffMemberships = staff ? (membershipsByStaff.get(staff.id) ?? []) : []
    const activeMembershipCount = staffMemberships.filter(item => item.active).length
    const inactiveMembershipCount = staffMemberships.length - activeMembershipCount
    const activeGrantCount = (patient ? (activePatientGrantsByPatient.get(patient.id) ?? 0) : 0) + (staff ? (activeStaffGrantsByStaff.get(staff.id) ?? 0) : 0)
    const pendingRequestCount = (patient ? (pendingPatientRequestsByPatient.get(patient.id) ?? 0) : 0) + (staff ? (pendingStaffRequestsByStaff.get(staff.id) ?? 0) : 0)
    const deleted = Boolean(profile?.deleted_at || patient?.deleted_at || staff?.deleted_at)

    return {
      id: authUserId,
      email: authUser.email,
      emailConfirmedAt: authUser.emailConfirmedAt,
      lastSignInAt: authUser.lastSignInAt,
      profile: profile ? {
        id: profile.id,
        authUserId: profile.auth_user_id,
        appRole: profile.app_role,
        displayName: profile.display_name,
        active: profile.active,
        deletedAt: profile.deleted_at,
        deletedByUserProfileId: profile.deleted_by_user_profile_id,
        deletedReason: profile.deleted_reason,
        mfaRequired: profile.mfa_required,
        createdAt: profile.created_at,
        restoredAt: profile.restored_at,
        restoredByUserProfileId: profile.restored_by_user_profile_id,
        updatedAt: profile.updated_at,
      } : null,
      patient: patient ? {
        id: patient.id,
        authUserId: patient.auth_user_id,
        userProfileId: patient.user_profile_id,
        hidCode: patient.hid_code,
        fullName: patient.full_name,
        email: patient.email,
        phone: patient.phone_e164,
        gender: patient.gender,
        dateOfBirth: patient.dob,
        country: patient.country,
        state: patient.state,
        emergencyContactName: patient.emergency_contact_name,
        emergencyContactPhone: patient.emergency_contact_phone,
        profilePercent: patient.profile_percent,
        notificationsEnabled: patient.notifications_enabled,
        createdAt: patient.created_at,
        updatedAt: patient.updated_at,
      } : null,
      staff: staff ? {
        id: staff.id,
        authUserId: staff.auth_user_id,
        userProfileId: staff.user_profile_id,
        fullName: staff.full_name,
        email: staff.email,
        phone: staff.phone_e164,
        hospitalName: staff.hospital_name,
        verificationStatus: staff.verification_status,
        licenseNumber: staff.license_number,
        role: staff.role,
        active: staff.active,
        createdAt: staff.created_at,
        updatedAt: staff.updated_at,
        memberships: staffMemberships
          .slice()
          .sort((left, right) => Number(right.is_primary) - Number(left.is_primary))
          .map(item => ({
            id: item.id,
            organizationId: item.organization_id,
            organizationName: orgsById.get(item.organization_id) ?? null,
            membershipRole: item.membership_role,
            appRole: item.app_role,
            isPrimary: item.is_primary,
            active: item.active,
            createdAt: item.created_at,
          })),
        activeMembershipCount,
        inactiveMembershipCount,
      } : null,
      stats: {
        activeGrantCount,
        pendingRequestCount,
        recordCount: patient ? (recordsByPatient.get(patient.id) ?? 0) : 0,
        unreadNotificationCount: profile ? (unreadByProfile.get(profile.id) ?? 0) : 0,
      },
      flags: {
        deleted,
        locked: deleted ? false : profile ? !profile.active : false,
        deletable: !deleted,
        lockable: !deleted,
        patientAccessOpen: patient ? activeGrantCount > 0 || pendingRequestCount > 0 : null,
        restrictable: Boolean(staff) && !deleted,
        restorable: deleted,
        staffAccessRestricted: staff ? (!deleted && (!staff.active || activeMembershipCount === 0)) : null,
      },
    } satisfies ManagedUser
  })
}

async function searchUsers(adminClient: ReturnType<typeof createAdminClient>, query: string) {
  const trimmed = asTrimmedString(query, 'query')
  const isEmailSearch = trimmed.includes('@')
  const searchPattern = `%${trimmed}%`

  const [patientResult, staffResult, authMatches] = await Promise.all([
    isEmailSearch
      ? adminClient
          .from('hid_patients')
          .select('auth_user_id')
          .ilike('email', searchPattern)
          .limit(12)
      : adminClient
          .from('hid_patients')
          .select('auth_user_id')
          .ilike('hid_code', searchPattern)
          .limit(12),
    isEmailSearch
      ? adminClient
          .from('hid_staff_accounts')
          .select('auth_user_id')
          .ilike('email', searchPattern)
          .limit(12)
      : Promise.resolve({ data: [], error: null }),
    isEmailSearch ? lookupAuthUsersByEmail(adminClient, trimmed) : Promise.resolve(new Map<string, MatchedAuthUser>()),
  ])

  if (patientResult.error) throw new HttpError(400, patientResult.error.message, patientResult.error)
  if (staffResult.error) throw new HttpError(400, staffResult.error.message, staffResult.error)

  const authUserIds = unique([
    ...((patientResult.data ?? []) as Array<{ auth_user_id: string }>).map(item => item.auth_user_id),
    ...((staffResult.data ?? []) as Array<{ auth_user_id: string }>).map(item => item.auth_user_id),
    ...authMatches.keys(),
  ])

  const matches = await loadManagedUsersByAuthIds(adminClient, authUserIds, authMatches)
  return matches.filter(item => {
    const loweredQuery = trimmed.toLowerCase()
    return (
      item.patient?.hidCode.toLowerCase().includes(loweredQuery) ||
      item.email?.toLowerCase().includes(loweredQuery) ||
      item.patient?.email?.toLowerCase().includes(loweredQuery) ||
      item.staff?.email?.toLowerCase().includes(loweredQuery)
    )
  })
}

async function listDeletedUsers(adminClient: ReturnType<typeof createAdminClient>, limit = 20) {
  const profilesResult = await adminClient
    .from('hid_user_profiles')
    .select('auth_user_id')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(limit)

  if (profilesResult.error) throw new HttpError(400, profilesResult.error.message, profilesResult.error)

  const authUserIds = unique(((profilesResult.data ?? []) as Array<{ auth_user_id: string }>).map(item => item.auth_user_id))
  return loadManagedUsersByAuthIds(adminClient, authUserIds)
}

async function loadManagedUserByAuthId(adminClient: ReturnType<typeof createAdminClient>, authUserId: string) {
  const matches = await loadManagedUsersByAuthIds(adminClient, [authUserId])
  return matches[0] ?? null
}

async function insertNotifications(
  adminClient: ReturnType<typeof createAdminClient>,
  items: Array<{ userProfileId: string; patientId?: string | null; title: string; message: string; type?: string }>,
) {
  if (items.length === 0) return
  const rows = items.map(item => ({
    user_profile_id: item.userProfileId,
    patient_id: item.patientId ?? null,
    title: item.title,
    message: item.message,
    type: item.type ?? 'system',
  }))
  const { error } = await adminClient.from('hid_notifications').insert(rows)
  if (error) throw new HttpError(400, error.message, error)
}

async function logAdminAuditEvent(
  adminClient: ReturnType<typeof createAdminClient>,
  actor: { userId: string; profileId: string | null; role: string },
  input: {
    action: string
    metadata?: Record<string, unknown>
    organizationId?: string | null
    patientId?: string | null
    reason?: string | null
    resourceId?: string | null
    resourceType: string
  },
) {
  const { error } = await adminClient.from('hid_audit_events').insert({
    actor_user_id: actor.userId,
    actor_profile_id: actor.profileId,
    actor_role: actor.role,
    patient_id: input.patientId ?? null,
    organization_id: input.organizationId ?? null,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    action: input.action,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  })

  if (error) throw new HttpError(400, error.message, error)
}

async function loadActionTarget(adminClient: ReturnType<typeof createAdminClient>, targetAuthUserId: string) {
  const [profileResult, patientResult, staffResult] = await Promise.all([
    adminClient
      .from('hid_user_profiles')
      .select('id, auth_user_id, app_role, display_name, active, deleted_at, deleted_reason, deleted_by_user_profile_id, mfa_required, created_at, restored_at, restored_by_user_profile_id, updated_at')
      .eq('auth_user_id', targetAuthUserId)
      .maybeSingle(),
    adminClient
      .from('hid_patients')
      .select('id, auth_user_id, user_profile_id, hid_code, full_name, email, phone_e164, gender, dob, country, state, emergency_contact_name, emergency_contact_phone, profile_percent, notifications_enabled, created_at, deleted_at, deleted_reason, restored_at, updated_at')
      .eq('auth_user_id', targetAuthUserId)
      .maybeSingle(),
    adminClient
      .from('hid_staff_accounts')
      .select('id, auth_user_id, user_profile_id, full_name, email, phone_e164, hospital_name, verification_status, license_number, role, active, created_at, deleted_at, deleted_reason, restored_at, updated_at')
      .eq('auth_user_id', targetAuthUserId)
      .maybeSingle(),
  ])

  if (profileResult.error) throw new HttpError(400, profileResult.error.message, profileResult.error)
  if (patientResult.error) throw new HttpError(400, patientResult.error.message, patientResult.error)
  if (staffResult.error) throw new HttpError(400, staffResult.error.message, staffResult.error)

  return {
    profile: (profileResult.data ?? null) as ProfileRow | null,
    patient: (patientResult.data ?? null) as PatientRow | null,
    staff: (staffResult.data ?? null) as StaffRow | null,
  }
}

async function performUserAction(
  adminClient: ReturnType<typeof createAdminClient>,
  actor: { role: string; userId: string; profileId: string | null },
  action: AdminUserManagementAction,
  targetAuthUserId: string,
) {
  const target = await loadActionTarget(adminClient, targetAuthUserId)
  if (!target.profile) throw new HttpError(404, 'We could not find this account.')
  const targetDeleted = Boolean(target.profile.deleted_at || target.patient?.deleted_at || target.staff?.deleted_at)

  // Platform-admin accounts have a separate, primary-admin-only control path.
  // Keeping them out of this generic endpoint prevents privilege bypasses.
  if (target.profile.app_role === 'platform_admin') {
    throw new HttpError(403, 'Platform admin accounts must be managed through the primary HID administrator controls.')
  }

  if (targetAuthUserId === actor.userId && ['lock_profile', 'unlock_profile', 'delete_account', 'restore_account'].includes(action)) {
    throw new HttpError(403, 'You cannot modify your own admin account from the dashboard.')
  }

  if (targetDeleted && !['restore_account', 'delete_account'].includes(action)) {
    throw new HttpError(409, 'This account is unavailable right now.')
  }

  if (action === 'lock_profile') {
    const [activeGrantsResult, pendingRequestsResult] = target.patient
      ? await Promise.all([
          adminClient
            .from('hid_access_grants')
            .select('id, patient_id, staff_account_id')
            .eq('patient_id', target.patient.id)
            .eq('status', 'active'),
          adminClient
            .from('hid_access_requests')
            .select('id, patient_id, requester_staff_account_id')
            .eq('patient_id', target.patient.id)
            .eq('status', 'pending'),
        ])
      : [{ data: [], error: null }, { data: [], error: null }]

    if (activeGrantsResult.error) throw new HttpError(400, activeGrantsResult.error.message, activeGrantsResult.error)
    if (pendingRequestsResult.error) throw new HttpError(400, pendingRequestsResult.error.message, pendingRequestsResult.error)

    const grantRows = (activeGrantsResult.data ?? []) as ActiveGrantRow[]
    const pendingRows = (pendingRequestsResult.data ?? []) as PendingRequestRow[]
    const affectedStaffIds = unique([
      ...grantRows.map(item => item.staff_account_id),
      ...pendingRows.map(item => item.requester_staff_account_id),
    ])

    const affectedStaffProfilesResult = affectedStaffIds.length > 0
      ? await adminClient
          .from('hid_staff_accounts')
          .select('id, user_profile_id')
          .in('id', affectedStaffIds)
      : { data: [], error: null }

    if (affectedStaffProfilesResult.error) {
      throw new HttpError(400, affectedStaffProfilesResult.error.message, affectedStaffProfilesResult.error)
    }

    const affectedStaffProfiles = (affectedStaffProfilesResult.data ?? []) as StaffProfileRow[]

    const [profileUpdate, userUpdate, grantUpdate, requestUpdate] = await Promise.all([
      adminClient
        .from('hid_user_profiles')
        .update({ active: false })
        .eq('auth_user_id', targetAuthUserId),
      adminClient.auth.admin.updateUserById(targetAuthUserId, {
        ban_duration: LOCK_BAN_DURATION,
      }),
      grantRows.length > 0
        ? adminClient
            .from('hid_access_grants')
            .update({
              status: 'revoked',
              revoked_at: new Date().toISOString(),
              revoked_by_user_profile_id: actor.profileId,
              revoked_reason: 'Patient account locked by HID admin.',
            })
            .in('id', grantRows.map(item => item.id))
        : Promise.resolve({ error: null }),
      pendingRows.length > 0
        ? adminClient
            .from('hid_access_requests')
            .update({
              status: 'denied',
              denied_at: new Date().toISOString(),
              denied_reason: 'Patient account locked by HID admin.',
            })
            .in('id', pendingRows.map(item => item.id))
        : Promise.resolve({ error: null }),
    ])

    if (profileUpdate.error) throw new HttpError(400, profileUpdate.error.message, profileUpdate.error)
    if (userUpdate.error) throw new HttpError(400, userUpdate.error.message, userUpdate.error)
    if ('error' in grantUpdate && grantUpdate.error) throw new HttpError(400, grantUpdate.error.message, grantUpdate.error)
    if ('error' in requestUpdate && requestUpdate.error) throw new HttpError(400, requestUpdate.error.message, requestUpdate.error)

    await insertNotifications(adminClient, [
      {
        userProfileId: target.profile.id,
        patientId: target.patient?.id ?? null,
        title: 'Account locked',
        message: 'An HID administrator locked this account. Contact: support@healthidentitydirectory.com',
      },
      ...affectedStaffProfiles.map(staffProfile => ({
        userProfileId: staffProfile.user_profile_id,
        patientId: target.patient?.id ?? null,
        title: 'Patient access closed',
        message: 'This patient account was locked by an HID administrator, so your access has been closed.',
      })),
    ])
    await logAdminAuditEvent(adminClient, actor, {
      action: 'admin_lock_profile',
      patientId: target.patient?.id ?? null,
      reason: 'Account locked by HID admin',
      resourceId: target.profile.id,
      resourceType: 'user_profile',
      metadata: {
        denied_requests: pendingRows.length,
        revoked_grants: grantRows.length,
        target_auth_user_id: targetAuthUserId,
      },
    })
  }

  if (action === 'unlock_profile') {
    const [profileUpdate, userUpdate] = await Promise.all([
      adminClient
        .from('hid_user_profiles')
        .update({ active: true })
        .eq('auth_user_id', targetAuthUserId),
      adminClient.auth.admin.updateUserById(targetAuthUserId, {
        ban_duration: 'none',
      }),
    ])

    if (profileUpdate.error) throw new HttpError(400, profileUpdate.error.message, profileUpdate.error)
    if (userUpdate.error) throw new HttpError(400, userUpdate.error.message, userUpdate.error)

    await insertNotifications(adminClient, [{
      userProfileId: target.profile.id,
      patientId: target.patient?.id ?? null,
      title: 'Account restored',
      message: 'An HID administrator restored this account. You can continue using HID.',
    }])
    await logAdminAuditEvent(adminClient, actor, {
      action: 'admin_unlock_profile',
      patientId: target.patient?.id ?? null,
      reason: 'Account restored by HID admin',
      resourceId: target.profile.id,
      resourceType: 'user_profile',
      metadata: {
        target_auth_user_id: targetAuthUserId,
      },
    })
  }

  if (action === 'restrict_staff_access') {
    if (!target.staff) throw new HttpError(404, 'We could not find that hospital account right now.')

    const [membershipsResult, activeGrantsResult, pendingRequestsResult] = await Promise.all([
      adminClient
        .from('hid_staff_memberships')
        .select('id')
        .eq('staff_account_id', target.staff.id),
      adminClient
        .from('hid_access_grants')
        .select('id, patient_id, staff_account_id')
        .eq('staff_account_id', target.staff.id)
        .eq('status', 'active'),
      adminClient
        .from('hid_access_requests')
        .select('id, patient_id, requester_staff_account_id')
        .eq('requester_staff_account_id', target.staff.id)
        .eq('status', 'pending'),
    ])

    if (membershipsResult.error) throw new HttpError(400, membershipsResult.error.message, membershipsResult.error)
    if (activeGrantsResult.error) throw new HttpError(400, activeGrantsResult.error.message, activeGrantsResult.error)
    if (pendingRequestsResult.error) throw new HttpError(400, pendingRequestsResult.error.message, pendingRequestsResult.error)

    const grantRows = (activeGrantsResult.data ?? []) as ActiveGrantRow[]
    const pendingRows = (pendingRequestsResult.data ?? []) as PendingRequestRow[]

    const [staffUpdate, membershipUpdate, grantUpdate, requestUpdate] = await Promise.all([
      adminClient
        .from('hid_staff_accounts')
        .update({ active: false })
        .eq('id', target.staff.id),
      adminClient
        .from('hid_staff_memberships')
        .update({ active: false })
        .eq('staff_account_id', target.staff.id),
      grantRows.length > 0
        ? adminClient
            .from('hid_access_grants')
            .update({
              status: 'revoked',
              revoked_at: new Date().toISOString(),
              revoked_by_user_profile_id: actor.profileId,
              revoked_reason: 'Access revoked by HID admin.',
            })
            .in('id', grantRows.map(item => item.id))
        : Promise.resolve({ error: null }),
      pendingRows.length > 0
        ? adminClient
            .from('hid_access_requests')
            .update({
              status: 'denied',
              denied_at: new Date().toISOString(),
              denied_reason: 'Access restricted by HID admin.',
            })
            .in('id', pendingRows.map(item => item.id))
        : Promise.resolve({ error: null }),
    ])

    if (staffUpdate.error) throw new HttpError(400, staffUpdate.error.message, staffUpdate.error)
    if (membershipUpdate.error) throw new HttpError(400, membershipUpdate.error.message, membershipUpdate.error)
    if ('error' in grantUpdate && grantUpdate.error) throw new HttpError(400, grantUpdate.error.message, grantUpdate.error)
    if ('error' in requestUpdate && requestUpdate.error) throw new HttpError(400, requestUpdate.error.message, requestUpdate.error)

    await insertNotifications(adminClient, [{
      userProfileId: target.profile.id,
      title: 'Access revoked',
      message: 'An HID administrator restricted this hospital account and revoked active patient access.',
    }])
    await logAdminAuditEvent(adminClient, actor, {
      action: 'admin_restrict_staff_access',
      reason: 'Staff access restricted by HID admin',
      resourceId: target.staff.id,
      resourceType: 'staff_account',
      metadata: {
        revoked_grants: grantRows.length,
        denied_requests: pendingRows.length,
        target_auth_user_id: targetAuthUserId,
      },
    })
  }

  if (action === 'restore_staff_access') {
    if (!target.staff) throw new HttpError(404, 'We could not find that hospital account right now.')

    const [staffUpdate, membershipUpdate] = await Promise.all([
      adminClient
        .from('hid_staff_accounts')
        .update({ active: true })
        .eq('id', target.staff.id),
      adminClient
        .from('hid_staff_memberships')
        .update({ active: true })
        .eq('staff_account_id', target.staff.id),
    ])

    if (staffUpdate.error) throw new HttpError(400, staffUpdate.error.message, staffUpdate.error)
    if (membershipUpdate.error) throw new HttpError(400, membershipUpdate.error.message, membershipUpdate.error)

    await insertNotifications(adminClient, [{
      userProfileId: target.profile.id,
      title: 'Access restored',
      message: 'An HID administrator restored this hospital account. New access requests can continue.',
    }])
    await logAdminAuditEvent(adminClient, actor, {
      action: 'admin_restore_staff_access',
      reason: 'Staff access restored by HID admin',
      resourceId: target.staff.id,
      resourceType: 'staff_account',
      metadata: {
        target_auth_user_id: targetAuthUserId,
      },
    })
  }

  if (action === 'close_patient_access') {
    if (!target.patient) throw new HttpError(404, 'We could not find that patient account right now.')

    const [activeGrantsResult, pendingRequestsResult] = await Promise.all([
      adminClient
        .from('hid_access_grants')
        .select('id, patient_id, staff_account_id')
        .eq('patient_id', target.patient.id)
        .eq('status', 'active'),
      adminClient
        .from('hid_access_requests')
        .select('id, patient_id, requester_staff_account_id')
        .eq('patient_id', target.patient.id)
        .eq('status', 'pending'),
    ])

    if (activeGrantsResult.error) throw new HttpError(400, activeGrantsResult.error.message, activeGrantsResult.error)
    if (pendingRequestsResult.error) throw new HttpError(400, pendingRequestsResult.error.message, pendingRequestsResult.error)

    const grantRows = (activeGrantsResult.data ?? []) as ActiveGrantRow[]
    const pendingRows = (pendingRequestsResult.data ?? []) as PendingRequestRow[]
    const affectedStaffIds = unique([
      ...grantRows.map(item => item.staff_account_id),
      ...pendingRows.map(item => item.requester_staff_account_id),
    ])

    const staffProfilesResult = affectedStaffIds.length > 0
      ? await adminClient
          .from('hid_staff_accounts')
          .select('id, user_profile_id')
          .in('id', affectedStaffIds)
      : { data: [], error: null }

    if (staffProfilesResult.error) throw new HttpError(400, staffProfilesResult.error.message, staffProfilesResult.error)
    const staffProfiles = (staffProfilesResult.data ?? []) as StaffProfileRow[]

    const [grantUpdate, requestUpdate] = await Promise.all([
      grantRows.length > 0
        ? adminClient
            .from('hid_access_grants')
            .update({
              status: 'revoked',
              revoked_at: new Date().toISOString(),
              revoked_by_user_profile_id: actor.profileId,
              revoked_reason: 'Access revoked by HID admin.',
            })
            .in('id', grantRows.map(item => item.id))
        : Promise.resolve({ error: null }),
      pendingRows.length > 0
        ? adminClient
            .from('hid_access_requests')
            .update({
              status: 'denied',
              denied_at: new Date().toISOString(),
              denied_reason: 'Access closed by HID admin.',
            })
            .in('id', pendingRows.map(item => item.id))
        : Promise.resolve({ error: null }),
    ])

    if ('error' in grantUpdate && grantUpdate.error) throw new HttpError(400, grantUpdate.error.message, grantUpdate.error)
    if ('error' in requestUpdate && requestUpdate.error) throw new HttpError(400, requestUpdate.error.message, requestUpdate.error)

    await insertNotifications(adminClient, [
      {
        userProfileId: target.profile.id,
        patientId: target.patient.id,
        title: 'Access closed',
        message: 'An HID administrator closed all active and pending provider access for this patient account.',
      },
      ...staffProfiles.map(item => ({
        userProfileId: item.user_profile_id,
        patientId: target.patient?.id ?? null,
        title: 'Access revoked',
        message: 'An HID administrator revoked or denied access tied to this patient.',
      })),
    ])
    await logAdminAuditEvent(adminClient, actor, {
      action: 'admin_close_patient_access',
      patientId: target.patient.id,
      reason: 'Patient access closed by HID admin',
      resourceId: target.patient.id,
      resourceType: 'patient',
      metadata: {
        denied_requests: pendingRows.length,
        revoked_grants: grantRows.length,
        target_auth_user_id: targetAuthUserId,
      },
    })
  }

  if (action === 'delete_account') {
    const { data, error } = await adminClient.rpc('hid_soft_delete_account_by_auth_user_id', {
      p_actor_profile_id: actor.profileId,
      p_auth_user_id: targetAuthUserId,
      p_reason: 'Account deleted by HID admin.',
    })

    if (error) throw new HttpError(400, error.message, error)
    const deleted = (data as { deleted?: boolean } | null)?.deleted ?? false
    const alreadyDeleted = (data as { already_deleted?: boolean } | null)?.already_deleted ?? false
    if (!deleted && !alreadyDeleted) {
      throw new HttpError(404, 'This account could not be deleted right now.')
    }

    const userUpdate = await adminClient.auth.admin.updateUserById(targetAuthUserId, {
      ban_duration: LOCK_BAN_DURATION,
    })
    if (userUpdate.error) throw new HttpError(400, userUpdate.error.message, userUpdate.error)

    await insertNotifications(adminClient, [{
      userProfileId: target.profile.id,
      patientId: target.patient?.id ?? null,
      title: 'Account deleted',
      message: 'This HID account was deleted and is no longer available.',
    }])
    await logAdminAuditEvent(adminClient, actor, {
      action: 'admin_soft_delete_account',
      patientId: target.patient?.id ?? null,
      reason: 'Account deleted by HID admin',
      resourceId: target.profile.id,
      resourceType: 'user_profile',
      metadata: {
        already_deleted: alreadyDeleted,
        target_auth_user_id: targetAuthUserId,
      },
    })

    const updated = await loadManagedUserByAuthId(adminClient, targetAuthUserId)
    return {
      deleted: true,
      targetAuthUserId,
      user: updated,
    }
  }

  if (action === 'restore_account') {
    const { data, error } = await adminClient.rpc('hid_restore_account_by_auth_user_id', {
      p_actor_profile_id: actor.profileId,
      p_auth_user_id: targetAuthUserId,
    })

    if (error) throw new HttpError(400, error.message, error)
    const restored = (data as { restored?: boolean } | null)?.restored ?? false
    if (!restored) {
      throw new HttpError(404, 'This account could not be restored right now.')
    }

    const userUpdate = await adminClient.auth.admin.updateUserById(targetAuthUserId, {
      ban_duration: 'none',
    })
    if (userUpdate.error) throw new HttpError(400, userUpdate.error.message, userUpdate.error)

    await insertNotifications(adminClient, [{
      userProfileId: target.profile.id,
      patientId: target.patient?.id ?? null,
      title: 'Account restored',
      message: 'An HID administrator restored this account. You can sign in again and continue using HID.',
    }])
    await logAdminAuditEvent(adminClient, actor, {
      action: 'admin_restore_account',
      patientId: target.patient?.id ?? null,
      reason: 'Account restored by HID admin',
      resourceId: target.profile.id,
      resourceType: 'user_profile',
      metadata: {
        target_auth_user_id: targetAuthUserId,
      },
    })
  }

  const updated = await loadManagedUserByAuthId(adminClient, targetAuthUserId)
  return {
    deleted: false,
    targetAuthUserId,
    user: updated,
  }
}

Deno.serve(req => withErrorHandling(req, async () => {
  const auth = await requireRole(req, ['platform_admin'])
  const adminClient = createAdminClient()

  if (req.method === 'GET') {
    const requestUrl = new URL(req.url)
    const includeDeleted = requestUrl.searchParams.get('deleted') === '1'
    const queryValue = requestUrl.searchParams.get('query')
    const matches = includeDeleted
      ? await listDeletedUsers(adminClient)
      : await searchUsers(adminClient, asTrimmedString(queryValue, 'query'))
    return json({ data: { matches } })
  }

  if (req.method === 'POST') {
    const body = await readJson<SearchPayload>(req)
    const action = asTrimmedString(body.action, 'action') as AdminUserManagementAction
    const targetAuthUserId = asTrimmedString(body.targetAuthUserId, 'targetAuthUserId')

    const data = await performUserAction(adminClient, {
      userId: auth.user.id,
      profileId: auth.profile?.id ?? null,
      role: auth.role,
    }, action, targetAuthUserId)
    return json({ data })
  }

  throw new HttpError(405, 'Method not allowed.')
}))
