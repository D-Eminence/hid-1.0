import type { Session } from '@supabase/supabase-js'
import type { AccessLog, AccessRequest, MedicalRecord, MedicalRecordFile, Notification, Patient } from '../types/database'
import type {
  HidHistoryActiveGrant,
  HidHistoryEvent,
  HidHistoryPendingRequest,
  HidNotification,
  HidPatient,
  HidPatientHistoryResponse,
  HidPatientProfileResponse,
  HidPatientRecordsResponse,
  HidSessionPayload,
  HidStaffAccount,
  HidStaffDashboardResponse,
} from '../types/hid'
import type { UploadDraft } from './medicalRecordUtils'
import { clearAllPortalSessions } from './auth'
import { registerCacheResetter } from './cacheReset'
import { BANNED_ACCOUNT_MESSAGE, isBannedAuthMessage } from './securityMessages'
import { fetchWithTimeout, getSafeSession, getSafeUser, NETWORK_TIMEOUT_MESSAGE, safeSignOut, supabase } from './supabase'

type PendingPatientSignup = {
  email?: string | null
  firstName: string
  lastName: string
  gender?: string | null
  dob?: string | null
  phone?: string | null
}

type PendingStaffOnboarding = {
  country?: string | null
  fullName: string
  hospitalName?: string | null
  licenseNumber?: string | null
  onboardingType?: 'hospital_signup' | 'staff_invite'
  phone?: string | null
  state?: string | null
}

type EdgeRequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
  query?: Record<string, string | number | undefined | null>
  requireAuth?: boolean
}

type EdgeEnvelope<T> = {
  data: T
}

type SignedUploadResponse = {
  signedUrl: string
  token: string
  path: string
  uploadToken: string
  uploadTokenExpiresAt: string
}

type SignedDownloadResponse = {
  signedUrl: string
}

type PasswordResetStartResponse = {
  challengeId: string
  deliveryChannels: Array<'email'>
  expiresAt: string
  maskedEmail: string | null
}

type PasswordResetVerifyResponse = {
  challengeId: string
  verificationToken: string
}

type AccountDeletionStartResponse = {
  challengeId: string
  deliveryChannels: Array<'email'>
  expiresAt: string
  maskedEmail: string | null
}

type AccountDeletionVerifyResponse = {
  challengeId: string
  verificationToken: string
}

type RecordCreationResponse = {
  record_id: string
  version_id: string
}

type UserSecurityProfile = {
  app_role: string | null
  deleted_at: string | null
  mfa_required: boolean
}

type PrivilegedMfaRequirement = {
  challengeFactorId: string | null
  challengeFactorLabel: string | null
  currentLevel: 'aal1' | 'aal2' | null
  nextLevel: 'aal1' | 'aal2' | null
  needsEnrollment: boolean
  required: boolean
}

type SignupAvailabilityResponse = {
  accountType: 'patient' | 'hospital'
  emailInUse: boolean
  emailOwner: 'patient' | 'hospital' | 'account' | null
  phoneInUse: boolean
}

type NotificationCountResponse = {
  count: number
}

type TotpEnrollment = {
  factorId: string
  friendlyName: string | null
  qrCode: string
  secret: string
  uri: string
}

type HistoryView = {
  pendingRequests: AccessRequest[]
  activeGrants: AccessRequest[]
  logs: AccessLog[]
}

const RECORD_FILE_BUCKET = 'medical-record-files'
const VIEW_CACHE_TTL_MS = 12000
const RECENT_RECORD_SAVE_TTL_MS = 5 * 60 * 1000
const RECORD_UPLOAD_TIMEOUT_MS = 90000
const RECORD_UPLOAD_RETRY_COUNT = 3
const NOTIFICATIONS_CACHE_TTL_MS = 10_000
const PRIVILEGED_MFA_ROLES = new Set(['platform_admin', 'org_admin', 'clinician'])
const HID_PATIENT_COLUMNS = [
  'id',
  'user_profile_id',
  'auth_user_id',
  'hid_code',
  'first_name',
  'last_name',
  'full_name',
  'phone_e164',
  'email',
  'gender',
  'dob',
  'blood_group',
  'genotype',
  'country',
  'state',
  'allergies',
  'chronic_conditions',
  'current_medications',
  'photo_url',
  'emergency_contact_name',
  'emergency_contact_relationship',
  'emergency_contact_phone',
  'emergency_contact_address',
  'medical_notes',
  'nin_last4',
  'nin_hash',
  'nin_ciphertext',
  'notifications_enabled',
  'profile_percent',
  'created_at',
  'updated_at',
].join(', ')
const HID_STAFF_ACCOUNT_COLUMNS = [
  'id',
  'user_profile_id',
  'auth_user_id',
  'full_name',
  'email',
  'phone_e164',
  'hospital_name',
  'verification_status',
  'license_number',
  'role',
  'active',
  'deleted_at',
  'created_at',
  'updated_at',
].join(', ')
const inflightRecordSaves = new Map<string, Promise<RecordCreationResponse>>()
const recentRecordSaves = new Map<string, RecentRecordSaveEntry>()

type ViewCacheEntry<T> = {
  expiresAt: number
  promise?: Promise<T>
  value?: T
}

type RecentRecordSaveEntry = {
  expiresAt: number
  result: RecordCreationResponse
  uploadedFileKeys: Set<string>
}

type SignedDownloadCacheEntry = {
  expiresAt: number
  promise?: Promise<string>
  value?: string
}

const viewCache = new Map<string, ViewCacheEntry<unknown>>()
const signedDownloadCache = new Map<string, SignedDownloadCacheEntry>()

function clearHidApiCaches() {
  viewCache.clear()
  signedDownloadCache.clear()
  inflightRecordSaves.clear()
  recentRecordSaves.clear()
}

registerCacheResetter(clearHidApiCaches)

export class HidApiError extends Error {
  status: number
  details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

function fallbackErrorMessageForStatus(status: number) {
  if (status === 400 || status === 422) return 'Some information is missing or not in the right format. Review it and try again.'
  if (status === 401) return 'Please sign in to continue.'
  if (status === 403) return 'This account is not allowed to do that right now.'
  if (status === 404) return 'We could not find the information you requested.'
  if (status === 408) return NETWORK_TIMEOUT_MESSAGE
  if (status === 409) return 'This action conflicts with existing information. Review the details and try again.'
  if (status === 429) return 'Too many requests were made too quickly. Please wait a moment and try again.'
  if (status >= 500) return 'This service is temporarily unavailable right now. Please try again shortly.'
  return 'That action could not be completed right now. Please try again.'
}

function isLowSignalErrorMessage(message: string) {
  const lower = message.toLowerCase()
  return (
    lower === 'request failed' ||
    lower === 'failed' ||
    lower === 'error' ||
    lower === 'internal server error' ||
    lower === 'bad request' ||
    lower === 'forbidden' ||
    lower === 'unauthorized' ||
    lower === 'not found' ||
    lower === 'service unavailable' ||
    lower === 'gateway timeout'
  )
}

function readCachedView<T>(key: string): { hit: boolean; value?: T } {
  const cached = viewCache.get(key) as ViewCacheEntry<T> | undefined
  if (!cached) return { hit: false }
  if (cached.value !== undefined && cached.expiresAt > Date.now()) {
    return { hit: true, value: cached.value }
  }
  if (!cached.promise) {
    viewCache.delete(key)
  }
  return { hit: false }
}

function writeCachedView<T>(key: string, value: T, ttlMs = VIEW_CACHE_TTL_MS) {
  viewCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  })
  return value
}

function invalidateViewCache(prefix: string) {
  for (const key of viewCache.keys()) {
    if (key.startsWith(prefix)) {
      viewCache.delete(key)
    }
  }
}

async function loadCachedView<T>(key: string, loader: () => Promise<T>, ttlMs = VIEW_CACHE_TTL_MS) {
  const immediate = readCachedView<T>(key)
  if (immediate.hit) {
    return immediate.value as T
  }

  const cached = viewCache.get(key) as ViewCacheEntry<T> | undefined
  if (cached?.promise) {
    return cached.promise
  }

  const promise = loader()
    .then(value => writeCachedView(key, value, ttlMs))
    .catch(error => {
      viewCache.delete(key)
      throw error
    })

  viewCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    promise,
  })

  return promise
}

function requireSupabaseUrl() {
  const value = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!value) {
    throw new HidApiError(500, 'Supabase is not configured for this app.')
  }

  return value
}

function requireSupabaseAnonKey() {
  const value = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!value) {
    throw new HidApiError(500, 'Supabase is not configured for this app.')
  }

  return value
}

function dataTable(table: string) {
  return (supabase as unknown as { from: (name: string) => any }).from(table)
}

function normalizePhone(value: string) {
  return value.replace(/[^0-9+]/g, '').trim()
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim() ?? ''
  return normalized || null
}

function normalizeComparableText(value: string | null | undefined) {
  return `${value ?? ''}`.trim().toLowerCase().replace(/\s+/g, ' ')
}

function looksLikeEmailIdentifier(value: string) {
  return /\S+@\S+\.\S+/.test(value.trim())
}

async function clearConflictingAuthSession(targetEmail?: string | null) {
  const normalizedTargetEmail = targetEmail?.trim().toLowerCase() ?? null
  const currentUser = await getSafeUser()

  if (!currentUser) return

  const currentEmail = currentUser.email?.trim().toLowerCase() ?? null
  if (normalizedTargetEmail && currentEmail === normalizedTargetEmail) return

  await safeSignOut()
  clearAllPortalSessions()
}

async function assertHospitalAccountCompatibleEmail() {
  const user = await getSafeUser()
  if (!user) return

  const requestedRole = `${user.user_metadata.requested_role ?? ''}`.trim().toLowerCase()
  const hasPendingPatientSignup = isPendingPatientSignup(user.user_metadata.pending_patient_signup)
  const hasPendingStaffOnboarding = isPendingStaffOnboarding(user.user_metadata.pending_staff_onboarding)

  if (requestedRole === 'patient' && !hasPendingStaffOnboarding) {
    await safeSignOut()
    clearAllPortalSessions()
    throw new HidApiError(
      409,
      hasPendingPatientSignup
        ? 'This email is already linked to a patient account. Use a different email for the hospital account.'
        : 'This email cannot be used for a hospital account. Use a different email address.'
    )
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isExistingAccountError(error: unknown) {
  if (!(error instanceof Error)) return false
  const lower = error.message.toLowerCase()
  return lower.includes('already registered') || lower.includes('already exists')
}

function hasSilentExistingSignupConflict(user: { identities?: Array<unknown> | null } | null | undefined) {
  return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0)
}

function isPatientProfileConflictError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; message?: string }
  const lower = `${candidate.message ?? ''}`.toLowerCase()
  return candidate.code === '23505' || lower.includes('duplicate key') || lower.includes('idx_hid_patients_phone') || lower.includes('idx_hid_patients_email')
}

export function isTotpEnrollmentUnavailableError(error: unknown) {
  if (!(error instanceof Error)) return false
  const lower = error.message.toLowerCase()
  return (
    lower.includes('mfa enroll is disabled for totp') ||
    lower.includes('totp enroll is disabled') ||
    (lower.includes('mfa') && lower.includes('disabled') && lower.includes('totp'))
  )
}

function isPendingPatientSignup(value: unknown): value is PendingPatientSignup {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.firstName === 'string' && typeof candidate.lastName === 'string'
}

function isPendingStaffOnboarding(value: unknown): value is PendingStaffOnboarding {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.fullName === 'string'
}

function formatDeletedAccountMessage(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('patient account has been deleted')) {
    return 'This patient account has been deleted and can no longer be opened by a hospital.'
  }
  if (lower.includes('account has been deleted')) {
    return 'This account has been deleted and is no longer available.'
  }
  return null
}

function formatLockedAccountMessage(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('patient account is locked')) {
    return 'This patient account is locked right now and cannot be opened by a hospital.'
  }
  if (lower.includes('account is inactive') || lower.includes('account is not active') || lower.includes('account is locked')) {
    return 'This account is locked right now. Contact support if you need help.'
  }
  return null
}

async function getAccessToken() {
  const session = await getSafeSession()
  return session?.access_token ?? null
}

async function resetAuthState() {
  try {
    await safeSignOut()
  } catch {
    // Best effort only.
  }
  clearAllPortalSessions()
  viewCache.clear()
}

async function edgeRequest<T>(functionName: string, options: EdgeRequestOptions = {}): Promise<T> {
  const url = new URL(`${requireSupabaseUrl()}/functions/v1/${functionName}`)
  const method = options.method ?? (options.body == null ? 'GET' : 'POST')

  Object.entries(options.query ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    url.searchParams.set(key, String(value))
  })

  const headers: Record<string, string> = {
    apikey: requireSupabaseAnonKey(),
  }

  if (options.requireAuth !== false) {
    const accessToken = await getAccessToken()
    if (!accessToken) {
      throw new HidApiError(401, 'Please sign in to continue.')
    }
    headers.Authorization = `Bearer ${accessToken}`
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetchWithTimeout(url.toString(), {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
    })
  } catch (error) {
    if (isAbortError(error) || (error instanceof Error && error.message.toLowerCase().includes('took too long'))) {
      throw new HidApiError(408, NETWORK_TIMEOUT_MESSAGE, error)
    }
    throw error
  }

  const rawBody = await response.text()
  let parsedPayload = null as
    | (EdgeEnvelope<T> & { error?: string; details?: unknown })
    | { error?: string; details?: unknown }
    | null

  if (rawBody) {
    try {
      parsedPayload = JSON.parse(rawBody) as
        | (EdgeEnvelope<T> & { error?: string; details?: unknown })
        | { error?: string; details?: unknown }
    } catch {
      parsedPayload = null
    }
  }

  const fallbackMessage = rawBody
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!response.ok) {
    const rawResponseMessage =
      parsedPayload && typeof parsedPayload === 'object' && 'error' in parsedPayload && typeof parsedPayload.error === 'string'
        ? parsedPayload.error
        : fallbackMessage || response.statusText || ''
    const normalizedAccountStateMessage = formatDeletedAccountMessage(rawResponseMessage) ?? formatLockedAccountMessage(rawResponseMessage)
    const responseMessage = isBannedAuthMessage(rawResponseMessage)
      ? BANNED_ACCOUNT_MESSAGE
      : normalizedAccountStateMessage
        ? normalizedAccountStateMessage
        : rawResponseMessage && !isLowSignalErrorMessage(rawResponseMessage)
          ? rawResponseMessage
          : fallbackErrorMessageForStatus(response.status)

    const lowered = responseMessage.toLowerCase()
    if (
      response.status === 401 ||
      lowered.includes('jwt') ||
      lowered.includes('refresh token') ||
      lowered.includes('authentication required') ||
      lowered.includes('please sign in again')
    ) {
      await resetAuthState()
    }

    throw new HidApiError(
      response.status,
      responseMessage,
      parsedPayload && typeof parsedPayload === 'object' && 'details' in parsedPayload ? parsedPayload.details : rawBody || parsedPayload
    )
  }

  if (parsedPayload && typeof parsedPayload === 'object' && 'data' in parsedPayload) {
    return parsedPayload.data
  }

  return (parsedPayload ?? rawBody) as T
}

async function clearPendingMetadata(key: 'pending_patient_signup' | 'pending_staff_onboarding') {
  const user = await getSafeUser()
  if (!user) return
  if (!(key in user.user_metadata)) return

  try {
    await supabase.auth.updateUser({
      data: {
        ...user.user_metadata,
        [key]: null,
      },
    })
  } catch {
    // Metadata cleanup is best effort only.
  }
}

function authRedirectUrl(path: 'patient' | 'hospital') {
  if (typeof window === 'undefined') return undefined
  if (path === 'hospital') return `${window.location.origin}/hospital/auth`
  return `${window.location.origin}/patient`
}

async function getCurrentUserSecurityProfile() {
  const user = await getSafeUser()
  if (!user) return null

  const { data: profile, error } = await supabase
    .from('hid_user_profiles')
    .select('app_role, deleted_at, mfa_required')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (error) {
    throw new HidApiError(400, error.message, error)
  }

  const profileRow = profile as Partial<UserSecurityProfile> | null
  if (profileRow?.deleted_at) return null
  return {
    app_role: typeof profileRow?.app_role === 'string' ? profileRow.app_role : null,
    deleted_at: typeof profileRow?.deleted_at === 'string' ? profileRow.deleted_at : null,
    mfa_required: Boolean(profileRow?.mfa_required),
  } satisfies UserSecurityProfile
}

async function getCurrentUserAppRole() {
  const profile = await getCurrentUserSecurityProfile()
  return profile?.app_role ?? null
}

async function requestSignupVerificationEmail(email: string, path: 'patient' | 'hospital', captchaToken?: string | null) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!looksLikeEmailIdentifier(normalizedEmail)) {
    throw new HidApiError(400, 'Enter a valid email address first.')
  }

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: normalizedEmail,
    options: {
      captchaToken: captchaToken ?? undefined,
      emailRedirectTo: authRedirectUrl(path),
    },
  })

  if (error) {
    throw new HidApiError(400, error.message, error)
  }
}

function formatSignupAvailabilityConflict(result: SignupAvailabilityResponse) {
  if (result.emailInUse && result.phoneInUse) {
    return 'The information has already been used, Try to sign in.'
  }
  if (result.emailInUse) {
    return 'The information has already been used, Try to sign in.'
  }
  if (result.phoneInUse) {
    return 'The information has already been used, Try to sign in.'
  }
  return null
}

async function checkSignupAvailability(params: {
  accountType: 'patient' | 'hospital'
  email?: string | null
  phone?: string | null
}) {
  const normalizedEmail = normalizeOptionalText(params.email?.trim().toLowerCase())
  const normalizedPhone = normalizeOptionalText(normalizePhone(params.phone ?? ''))
  const cacheKey = `signup-availability:${params.accountType}:${normalizedEmail ?? ''}:${normalizedPhone ?? ''}`

  return loadCachedView(
    cacheKey,
    () => edgeRequest<SignupAvailabilityResponse>('signup-availability', {
      method: 'POST',
      requireAuth: false,
      body: {
        accountType: params.accountType,
        email: normalizedEmail,
        phone: normalizedPhone,
      },
    }),
    8_000,
  )
}

async function assertSignupAvailability(params: {
  accountType: 'patient' | 'hospital'
  email?: string | null
  phone?: string | null
}) {
  const result = await checkSignupAvailability(params)
  const conflictMessage = formatSignupAvailabilityConflict(result)
  if (conflictMessage) {
    throw new HidApiError(409, conflictMessage, result)
  }
}

async function assertNoSilentSignupConflict(params: {
  accountType: 'patient' | 'hospital'
  email?: string | null
  phone?: string | null
  user: { identities?: Array<unknown> | null } | null | undefined
}) {
  if (!hasSilentExistingSignupConflict(params.user)) return

  const availability = await checkSignupAvailability({
    accountType: params.accountType,
    email: params.email,
    phone: params.phone,
  })

  throw new HidApiError(
    409,
    formatSignupAvailabilityConflict(availability) ?? 'The information has already been used, Try to sign in.',
    availability,
  )
}

function toFriendlyFactorLabel(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function listMfaFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) {
    throw new HidApiError(400, error.message, error)
  }
  return data
}

export async function getPrivilegedMfaRequirement(): Promise<PrivilegedMfaRequirement> {
  const profile = await getCurrentUserSecurityProfile()
  if (!profile?.mfa_required || !profile.app_role || !PRIVILEGED_MFA_ROLES.has(profile.app_role)) {
    return {
      challengeFactorId: null,
      challengeFactorLabel: null,
      currentLevel: null,
      nextLevel: null,
      needsEnrollment: false,
      required: false,
    }
  }

  const [{ data: assurance, error: assuranceError }, factors] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    listMfaFactors(),
  ])

  if (assuranceError) {
    throw new HidApiError(400, assuranceError.message, assuranceError)
  }

  const verifiedTotp = (factors?.totp ?? []).find(factor => typeof factor?.id === 'string') ?? null
  const currentLevel = assurance?.currentLevel ?? null
  const nextLevel = assurance?.nextLevel ?? null

  return {
    challengeFactorId: typeof verifiedTotp?.id === 'string' ? verifiedTotp.id : null,
    challengeFactorLabel: toFriendlyFactorLabel(verifiedTotp?.friendly_name),
    currentLevel,
    nextLevel,
    needsEnrollment: !verifiedTotp,
    required: currentLevel !== 'aal2',
  }
}

export async function enrollPrivilegedTotp(friendlyName: string): Promise<TotpEnrollment> {
  const factors = await listMfaFactors()
  const staleUnverifiedTotp = (factors?.all ?? []).filter(
    factor => factor.factor_type === 'totp' && factor.status !== 'verified' && typeof factor.id === 'string',
  )

  for (const factor of staleUnverifiedTotp) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id }).catch(() => undefined)
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  })

  if (error || !data?.id || !data.totp?.qr_code || !data.totp.secret || !data.totp.uri) {
    throw new HidApiError(400, error?.message ?? 'Unable to start multi-factor setup right now.', error)
  }

  return {
    factorId: data.id,
    friendlyName: toFriendlyFactorLabel(data.friendly_name) ?? friendlyName,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  }
}

export async function verifyPrivilegedTotp(factorId: string, code: string) {
  const normalizedCode = code.trim()
  if (normalizedCode.length !== 6) {
    throw new HidApiError(400, 'Enter the 6-digit authenticator code first.')
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: normalizedCode,
  })

  if (error) {
    throw new HidApiError(400, error.message, error)
  }
}

async function requestEmailOtp(email: string, captchaToken?: string | null) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!looksLikeEmailIdentifier(normalizedEmail)) {
    throw new HidApiError(400, 'Enter a valid email address first.')
  }

  await clearConflictingAuthSession(normalizedEmail)

  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: false,
      captchaToken: captchaToken ?? undefined,
    },
  })

  if (error) {
    throw new HidApiError(400, error.message, error)
  }
}

async function verifyEmailOtp(email: string, code: string) {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedCode = code.trim()

  const { data, error } = await supabase.auth.verifyOtp({
    email: normalizedEmail,
    token: normalizedCode,
    type: 'email',
  })

  if (error) {
    throw new HidApiError(400, error.message, error)
  }

  if (!data.session) {
    throw new HidApiError(400, 'The verification code is not correct.')
  }
}

async function verifySignupOtpAndEnsureSession(email: string, password: string, code: string) {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedCode = code.trim()

  const { data, error } = await supabase.auth.verifyOtp({
    email: normalizedEmail,
    token: normalizedCode,
    type: 'signup',
  })

  if (error) {
    throw new HidApiError(400, error.message, error)
  }

  if (!data.session) {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })

    if (signInError) {
      throw new HidApiError(
        401,
        isBannedAuthMessage(signInError.message)
          ? BANNED_ACCOUNT_MESSAGE
          : signInError.message,
        signInError
      )
    }
  }
}

export function toLegacyPatient(patient: HidPatient): Patient {
  return {
    id: patient.id,
    first_name: patient.first_name,
    last_name: patient.last_name,
    full_name: patient.full_name,
    phone: patient.phone_e164,
    email: patient.email,
    gender: patient.gender,
    auth_password_hash: null,
    blood_group: patient.blood_group ?? 'Unknown',
    nin_verified: Boolean(patient.nin_hash || patient.nin_ciphertext || patient.nin_last4),
    hid_code: patient.hid_code,
    pin: null,
    created_at: patient.created_at,
    nin: patient.nin_last4 ? `****${patient.nin_last4}` : null,
    dob: patient.dob,
    country: patient.country,
    state: patient.state,
    genotype: patient.genotype,
    allergies: patient.allergies,
    chronic_conditions: patient.chronic_conditions,
    current_medications: patient.current_medications,
    photo_url: patient.photo_url,
    emergency_contact_name: patient.emergency_contact_name,
    emergency_contact_relationship: patient.emergency_contact_relationship,
    emergency_contact_phone: patient.emergency_contact_phone,
    emergency_contact_address: patient.emergency_contact_address,
    medical_notes: patient.medical_notes,
    profile_percent: patient.profile_percent,
    notifications_enabled: patient.notifications_enabled,
    access_pin_configured: Boolean(patient.access_pin_configured),
  }
}

function inferLegacyAccessType(scope: string, breakGlass = false): 'standard' | 'emergency' {
  if (breakGlass || scope === 'break_glass') return 'emergency'
  return 'standard'
}

function toLegacyAccessRequest(
  hidCode: string,
  entry: HidHistoryPendingRequest | HidHistoryActiveGrant
): AccessRequest {
  const startTime = 'starts_at' in entry ? entry.starts_at : entry.created_at
  const endTime = 'expires_at' in entry ? entry.expires_at : null
  const durationHours = endTime
    ? Math.max(1, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / (60 * 60 * 1000)))
    : null

  return {
    id: 'grant_id' in entry ? entry.grant_id : entry.request_id,
    hid_code: hidCode,
    doctor_account_id: entry.staff_account_id,
    doctor_name: entry.staff_name,
    request_type: inferLegacyAccessType(entry.scope, entry.break_glass),
    status: 'grant_id' in entry ? 'approved' : 'pending',
    reason: entry.reason,
    pin_verified: false,
    approved_by: 'grant_id' in entry ? 'Patient' : null,
    approved_at: 'starts_at' in entry ? entry.starts_at : entry.approved_at,
    duration_hours: durationHours,
    access_expires_at: 'expires_at' in entry ? entry.expires_at : null,
    created_at: startTime,
  }
}

function toLegacyAccessLog(hidCode: string, event: HidHistoryEvent): AccessLog {
  const reasonText = `${event.reason ?? ''} ${JSON.stringify(event.metadata ?? {})}`.toLowerCase()
  return {
    id: event.event_id,
    hid_code: hidCode,
    accessed_by: event.actor_name,
    access_time: event.created_at,
    reason: event.reason,
    access_type: reasonText.includes('break_glass') || event.action.includes('break_glass') ? 'emergency' : 'standard',
    request_id: typeof event.metadata?.request_id === 'string' ? event.metadata.request_id : null,
  }
}

type RawPatientHistoryRequest = {
  id: string
  requester_staff_account_id: string
  staff_display_name?: string | null
  scope: HidHistoryPendingRequest['scope']
  status: HidHistoryPendingRequest['status']
  reason: string | null
  break_glass: boolean | null
  created_at: string
  approved_at: string | null
}

type RawPatientHistoryGrant = {
  id: string
  request_id: string | null
  staff_account_id: string
  staff_display_name?: string | null
  scope: HidHistoryActiveGrant['scope']
  status: HidHistoryActiveGrant['status']
  reason: string | null
  starts_at: string
  expires_at: string
}

type RawPatientHistoryEvent = {
  event_id: string
  action: string
  actor_role: string | null
  resource_type: string
  reason: string | null
  request_id: string | null
  metadata: unknown
  created_at: string
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function metadataText(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function shouldUsePatientHistoryTableFallback(error: unknown) {
  if (!(error instanceof HidApiError)) return false
  const lower = error.message.toLowerCase()
  return (
    error.status >= 500 ||
    lower.includes('temporarily unavailable') ||
    lower.includes('statement timeout') ||
    lower.includes('canceling statement due to statement timeout')
  )
}

async function selectPatientHistoryRows<T>(
  tableName: string,
  selectWithDisplayName: string,
  selectWithoutDisplayName: string,
  configure: (query: any) => any
) {
  let result = await configure(dataTable(tableName).select(selectWithDisplayName))

  if (result.error && `${result.error.message ?? ''}`.toLowerCase().includes('staff_display_name')) {
    result = await configure(dataTable(tableName).select(selectWithoutDisplayName))
  }

  if (result.error) {
    throw new HidApiError(400, result.error.message, result.error)
  }

  return (result.data ?? []) as T[]
}

async function fetchPatientHistoryFromTables(hidCode: string): Promise<HistoryView> {
  const [pendingRows, grantRows, eventResult] = await Promise.all([
    selectPatientHistoryRows<RawPatientHistoryRequest>(
      'hid_access_requests',
      'id, requester_staff_account_id, staff_display_name, scope, status, reason, break_glass, created_at, approved_at',
      'id, requester_staff_account_id, scope, status, reason, break_glass, created_at, approved_at',
      query => query.eq('status', 'pending').order('created_at', { ascending: false })
    ),
    selectPatientHistoryRows<RawPatientHistoryGrant>(
      'hid_access_grants',
      'id, request_id, staff_account_id, staff_display_name, scope, status, reason, starts_at, expires_at',
      'id, request_id, staff_account_id, scope, status, reason, starts_at, expires_at',
      query => query.eq('status', 'active').gt('expires_at', new Date().toISOString()).order('starts_at', { ascending: false })
    ),
    dataTable('hid_audit_events')
      .select('event_id, action, actor_role, resource_type, reason, request_id, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (eventResult.error) {
    throw new HidApiError(400, eventResult.error.message, eventResult.error)
  }

  const pendingRequests = pendingRows.map(row => toLegacyAccessRequest(hidCode, {
    request_id: row.id,
    staff_account_id: row.requester_staff_account_id,
    staff_name: row.staff_display_name?.trim() || 'Provider',
    staff_role: 'doctor',
    hospital_name: null,
    scope: row.scope,
    status: row.status,
    reason: row.reason ?? 'Access request',
    break_glass: Boolean(row.break_glass),
    created_at: row.created_at,
    approved_at: row.approved_at,
  }))

  const activeGrants = grantRows.map(row => toLegacyAccessRequest(hidCode, {
    grant_id: row.id,
    request_id: row.request_id,
    staff_account_id: row.staff_account_id,
    staff_name: row.staff_display_name?.trim() || 'Provider',
    staff_role: 'doctor',
    hospital_name: null,
    scope: row.scope,
    status: row.status,
    reason: row.reason ?? 'Access currently active',
    starts_at: row.starts_at,
    expires_at: row.expires_at,
    break_glass: row.scope === 'break_glass',
  }))

  const logs = ((eventResult.data ?? []) as RawPatientHistoryEvent[]).map(row => {
    const metadata = metadataRecord(row.metadata)
    const event: HidHistoryEvent = {
      event_id: row.event_id,
      action: row.action,
      resource_type: row.resource_type,
      reason: row.reason,
      created_at: row.created_at,
      actor_name: metadataText(metadata, ['staff_display_name', 'staff_name', 'actor_name', 'provider_name']) ?? 'System',
      actor_role: row.actor_role ?? metadataText(metadata, ['actor_role', 'staff_role']) ?? 'system',
      hospital_name: metadataText(metadata, ['hospital_name']),
      metadata: {
        ...metadata,
        request_id: typeof metadata.request_id === 'string' ? metadata.request_id : row.request_id,
      },
    }
    return toLegacyAccessLog(hidCode, event)
  })

  return {
    pendingRequests,
    activeGrants,
    logs,
  }
}

function toLegacyNotification(notification: HidNotification, hidCode: string): Notification {
  return {
    id: notification.id,
    hid_code: hidCode,
    title: notification.title,
    message: notification.message,
    type: notification.type as Notification['type'],
    is_read: Boolean(notification.read_at),
    created_at: notification.created_at,
  }
}

async function signRecordDownload(fileId: string) {
  const cacheKey = `${fileId}:180`
  const now = Date.now()
  const cached = signedDownloadCache.get(cacheKey)

  if (cached?.value && cached.expiresAt > now) {
    return { signedUrl: cached.value }
  }

  if (cached?.promise) {
    const signedUrl = await cached.promise
    return { signedUrl }
  }

  const request = edgeRequest<SignedDownloadResponse>('files-sign-download', {
    method: 'POST',
    body: { fileId, expiresIn: 180 },
  })
    .then(response => {
      signedDownloadCache.set(cacheKey, {
        expiresAt: Date.now() + 120_000,
        value: response.signedUrl,
      })
      return response.signedUrl
    })
    .catch(error => {
      signedDownloadCache.delete(cacheKey)
      throw error
    })

  signedDownloadCache.set(cacheKey, {
    expiresAt: now + 120_000,
    promise: request,
  })

  const signedUrl = await request
  return { signedUrl }
}

async function toLegacyRecordFiles(files: HidPatientRecordsResponse['records'][number]['files']): Promise<MedicalRecordFile[]> {
  const resolvedFiles = await Promise.all(files.map(async file => {
    try {
      const signedUrl = file.signed_download_url || (await signRecordDownload(file.id)).signedUrl
      return {
        id: file.id,
        record_id: file.record_id,
        file_name: file.original_file_name,
        file_type: file.mime_type,
        file_data_url: signedUrl,
        created_at: file.created_at,
      } satisfies MedicalRecordFile
    } catch {
      return {
        id: file.id,
        record_id: file.record_id,
        file_name: file.original_file_name,
        file_type: file.mime_type,
        file_data_url: '',
        created_at: file.created_at,
      } satisfies MedicalRecordFile
    }
  }))

  return resolvedFiles
}

function toLegacyMedicalRecord(
  patient: HidPatient,
  bundle: HidPatientRecordsResponse['records'][number],
  files: MedicalRecordFile[]
): MedicalRecord {
  const firstFile = files[0]
  const version = bundle.current_version
  return {
    id: bundle.record.id,
    hid_code: patient.hid_code,
    title: bundle.record.title,
    category: (bundle.record.category as MedicalRecord['category']) ?? 'other',
    record: version?.record ?? 'No record details available.',
    notes: version?.notes ?? null,
    attachment_name: firstFile?.file_name ?? null,
    attachment_type: firstFile?.file_type ?? null,
    attachment_data_url: firstFile?.file_data_url ?? null,
    transcription_text: version?.transcription_text ?? null,
    created_by: version?.created_by_name ?? bundle.record.created_by_name ?? 'Authorized user',
    added_by_role: version?.created_by_role ?? bundle.record.created_by_role ?? 'patient',
    created_at: bundle.record.created_at,
  }
}

async function dataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) {
    const response = await fetchWithTimeout(dataUrl)
    return response.blob()
  }

  const mimeType = match[1] || 'application/octet-stream'
  const isBase64 = Boolean(match[2])
  const payload = match[3] ?? ''

  if (isBase64) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new Blob([bytes], { type: mimeType })
  }

  return new Blob([decodeURIComponent(payload)], { type: mimeType })
}

function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function buildUploadDraftKey(upload: UploadDraft) {
  return `${upload.file_name}:${upload.file_type ?? ''}:${upload.file_data_url.length}`
}

function pruneRecentRecordSaves() {
  const now = Date.now()
  for (const [key, value] of recentRecordSaves.entries()) {
    if (value.expiresAt <= now) {
      recentRecordSaves.delete(key)
    }
  }
}

async function fetchWithManualTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(new Error(NETWORK_TIMEOUT_MESSAGE)), timeoutMs)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new HidApiError(408, NETWORK_TIMEOUT_MESSAGE, error)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function retryRecordUpload<T>(operation: () => Promise<T>) {
  let lastError: unknown = null
  for (let attempt = 0; attempt < RECORD_UPLOAD_RETRY_COUNT; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof HidApiError && [400, 401, 403, 404, 409, 422].includes(error.status)) {
        throw error
      }
      lastError = error
      if (attempt === RECORD_UPLOAD_RETRY_COUNT - 1) break
      await delay(400 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new HidApiError(502, 'Unable to finish uploading the attached files right now.')
}

export async function fetchPatientProfileBundle() {
  return edgeRequest<HidPatientProfileResponse>('patients-me')
}

async function fetchPatientProfileBundleWithRetry(attempts = 5, delayMs = 160) {
  let lastError: unknown = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchPatientProfileBundle()
    } catch (error) {
      lastError = error
      if (!(error instanceof HidApiError) || error.status !== 404 || attempt === attempts - 1) {
        throw error
      }
      await delay(delayMs * (attempt + 1))
    }
  }

  throw lastError instanceof Error ? lastError : new HidApiError(404, 'Patient profile not found.')
}

export async function ensurePatientProfileRegistered(override?: PendingPatientSignup) {
  try {
    return await fetchPatientProfileBundle()
  } catch (error) {
    if (!(error instanceof HidApiError) || error.status !== 404) throw error
  }

  const user = await getSafeUser()
  if (!user) {
    throw new HidApiError(401, 'Please sign in to continue.')
  }

  const pendingData = override ?? (
    isPendingPatientSignup(user.user_metadata.pending_patient_signup)
      ? user.user_metadata.pending_patient_signup
      : null
  )

  if (!pendingData) {
    throw new HidApiError(400, 'Your patient profile is incomplete. Start the sign-up process again.')
  }

  try {
    await edgeRequest<{ patient_id: string; hid_code: string }>('patient-register', {
      method: 'POST',
      body: {
        firstName: pendingData.firstName,
        lastName: pendingData.lastName,
        gender: normalizeOptionalText(pendingData.gender),
        dob: normalizeOptionalText(pendingData.dob),
        phone: normalizeOptionalText(pendingData.phone),
      },
    })
  } catch (error) {
    if (!(error instanceof HidApiError) || !isExistingAccountError(error)) {
      throw error
    }
  }

  await clearPendingMetadata('pending_patient_signup')
  return fetchPatientProfileBundleWithRetry()
}

export async function fetchMyPatient() {
  const session = await getSafeSession()
  const userId = session?.user.id
  if (!userId) {
    throw new HidApiError(401, 'Please sign in to continue.')
  }

  return loadCachedView(`patient:${userId}`, async () => {
    const bundle = await ensurePatientProfileRegistered()
    return toLegacyPatient(bundle.patient)
  })
}

export async function updateMyPatientProfile(patch: Partial<Patient>) {
  const current = await ensurePatientProfileRegistered()
  const payload = {
    first_name: patch.first_name ?? current.patient.first_name,
    last_name: patch.last_name ?? current.patient.last_name,
    full_name: patch.full_name ?? `${patch.first_name ?? current.patient.first_name} ${patch.last_name ?? current.patient.last_name}`.trim(),
    phone_e164: patch.phone ?? current.patient.phone_e164,
    email: patch.email ?? current.patient.email,
    gender: patch.gender ?? current.patient.gender,
    dob: patch.dob ?? current.patient.dob,
    blood_group: patch.blood_group ?? current.patient.blood_group,
    genotype: patch.genotype ?? current.patient.genotype,
    country: patch.country ?? current.patient.country,
    state: patch.state ?? current.patient.state,
    allergies: patch.allergies ?? current.patient.allergies,
    chronic_conditions: patch.chronic_conditions ?? current.patient.chronic_conditions,
    current_medications: patch.current_medications ?? current.patient.current_medications,
    photo_url: patch.photo_url ?? current.patient.photo_url,
    emergency_contact_name: patch.emergency_contact_name ?? current.patient.emergency_contact_name,
    emergency_contact_relationship: patch.emergency_contact_relationship ?? current.patient.emergency_contact_relationship,
    emergency_contact_phone: patch.emergency_contact_phone ?? current.patient.emergency_contact_phone,
    emergency_contact_address: patch.emergency_contact_address ?? current.patient.emergency_contact_address,
    medical_notes: patch.medical_notes ?? current.patient.medical_notes,
    notifications_enabled: patch.notifications_enabled ?? current.patient.notifications_enabled,
    profile_percent: patch.profile_percent ?? current.patient.profile_percent,
  }

  const { data, error } = await dataTable('hid_patients')
    .update(payload)
    .eq('id', current.patient.id)
    .select(HID_PATIENT_COLUMNS)
    .single()

  if (error) {
    if (isPatientProfileConflictError(error)) {
      throw new HidApiError(409, 'That email address or phone number is already linked to another HID account.', error)
    }
    throw new HidApiError(400, error.message ?? 'Unable to save the patient profile.', error)
  }

  if (!data) {
    throw new HidApiError(400, 'We could not save that profile information right now. Please review the email address and phone number, then try again.')
  }

  invalidateViewCache('patient:')
  return {
    ...toLegacyPatient(data as HidPatient),
    access_pin_configured: Boolean(current.patient.access_pin_configured),
  }
}

export async function setMyPatientAccessPin(accessPin?: string | null) {
  const response = await edgeRequest<{ configured: boolean }>('patient-access-pin', {
    method: 'POST',
    body: {
      accessPin: normalizeOptionalText(accessPin),
    },
  })
  invalidateViewCache('patient:')
  return response
}

export async function countUnreadNotifications(options: { forceRefresh?: boolean } = {}) {
  if (options.forceRefresh) {
    viewCache.delete('notifications:count:self')
  }

  return loadCachedView('notifications:count:self', async () => {
    const response = await edgeRequest<NotificationCountResponse>('notifications-list', {
      query: {
        countOnly: '1',
        unreadOnly: '1',
      },
    })

    return Number.isFinite(response.count) ? response.count : 0
  }, NOTIFICATIONS_CACHE_TTL_MS)
}

export async function listNotifications(hidCode: string, options: { forceRefresh?: boolean } = {}) {
  const cacheKey = `notifications:list:${hidCode}`
  if (options.forceRefresh) {
    viewCache.delete(cacheKey)
  }

  return loadCachedView(cacheKey, async () => {
    const data = await edgeRequest<HidNotification[]>('notifications-list', {
      query: {
        limit: 200,
      },
    })

    return (data ?? []).map(item => toLegacyNotification(item, hidCode))
  }, NOTIFICATIONS_CACHE_TTL_MS)
}

export async function listUnreadNotifications(hidCode: string, limit = 20, options: { forceRefresh?: boolean } = {}) {
  const cacheKey = `notifications:unread:${hidCode}:${limit}`
  if (options.forceRefresh) {
    viewCache.delete(cacheKey)
  }

  return loadCachedView(cacheKey, async () => {
    const data = await edgeRequest<HidNotification[]>('notifications-list', {
      query: {
        limit,
        unreadOnly: '1',
      },
    })

    return (data ?? []).map(item => toLegacyNotification(item, hidCode))
  }, NOTIFICATIONS_CACHE_TTL_MS)
}

export async function markNotificationRead(id: string) {
  const { error } = await dataTable('hid_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    throw new HidApiError(400, error.message, error)
  }

  invalidateViewCache('notifications:')
}

export async function markAllNotificationsRead() {
  const { error } = await dataTable('hid_notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)

  if (error) {
    throw new HidApiError(400, error.message, error)
  }

  invalidateViewCache('notifications:')
}

export async function fetchPatientRecordsView(patientIdentifier?: string, options: { forceRefresh?: boolean } = {}) {
  const cacheKey = `records:${patientIdentifier ?? 'self'}`
  if (options.forceRefresh) {
    viewCache.delete(cacheKey)
  }

  return loadCachedView(cacheKey, async () => {
    const bundle = await edgeRequest<HidPatientRecordsResponse>('patients-records', {
      query: {
        patientIdentifier: patientIdentifier ?? null,
      },
    })

    const patient = toLegacyPatient(bundle.patient)
    const fileGroups = await Promise.all(bundle.records.map(async item => {
      const files = await toLegacyRecordFiles(item.files)
      return [item.record.id, files] as const
    }))

    const recordFiles = Object.fromEntries(fileGroups) as Record<string, MedicalRecordFile[]>
    const records = bundle.records.map(item => toLegacyMedicalRecord(bundle.patient, item, recordFiles[item.record.id] ?? []))

    return {
      patient,
      records,
      recordFiles,
      rawPatient: bundle.patient,
    }
  }, patientIdentifier ? 0 : VIEW_CACHE_TTL_MS)
}

export async function createMedicalRecordWithUploads({
  patientIdentifier,
  title,
  category,
  record,
  notes,
  uploads,
}: {
  patientIdentifier: string
  title: string
  category: string
  record: string
  notes?: string | null
  uploads?: UploadDraft[]
}) {
  pruneRecentRecordSaves()
  const normalizedNotes = normalizeOptionalText(notes)
  const uploadsFingerprint = (uploads ?? [])
    .map(buildUploadDraftKey)
    .join('|')
  const requestKey = [
    patientIdentifier.trim().toUpperCase(),
    title.trim(),
    category.trim().toLowerCase(),
    record.trim(),
    normalizedNotes ?? '',
    uploadsFingerprint,
  ].join('::')

  const existing = inflightRecordSaves.get(requestKey)
  if (existing) {
    return existing
  }

  const request = (async () => {
    let saveEntry = recentRecordSaves.get(requestKey)
    if (!saveEntry || saveEntry.expiresAt <= Date.now()) {
      const created = await edgeRequest<RecordCreationResponse>('records-create', {
        method: 'POST',
        body: {
          patientIdentifier,
          title,
          category,
          record,
          notes: normalizedNotes,
        },
      })

      saveEntry = {
        expiresAt: Date.now() + RECENT_RECORD_SAVE_TTL_MS,
        result: created,
        uploadedFileKeys: new Set<string>(),
      }
      recentRecordSaves.set(requestKey, saveEntry)
    }

    if (uploads && uploads.length > 0) {
      await uploadRecordFiles(saveEntry.result.record_id, uploads, saveEntry.uploadedFileKeys)
    }

    invalidateViewCache('records:')
    invalidateViewCache('history:')
    invalidateViewCache('staff-dashboard:')
    saveEntry.expiresAt = Date.now() + RECENT_RECORD_SAVE_TTL_MS
    recentRecordSaves.set(requestKey, saveEntry)
    return saveEntry.result
  })()

  inflightRecordSaves.set(requestKey, request)

  try {
    return await request
  } finally {
    inflightRecordSaves.delete(requestKey)
  }
}

export async function uploadRecordFiles(recordId: string, uploads: UploadDraft[], uploadedFileKeys = new Set<string>()) {
  for (const upload of uploads) {
    const uploadKey = buildUploadDraftKey(upload)
    if (uploadedFileKeys.has(uploadKey)) continue

    await retryRecordUpload(async () => {
      const signed = await edgeRequest<SignedUploadResponse>('files-sign-upload', {
        method: 'POST',
        body: {
          recordId,
          fileName: upload.file_name,
        },
      })

      const blob = await dataUrlToBlob(upload.file_data_url)
      const uploadResponse = await fetchWithManualTimeout(signed.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': upload.file_type ?? 'application/octet-stream',
        },
        body: blob,
      }, RECORD_UPLOAD_TIMEOUT_MS)

      if (!uploadResponse.ok) {
        throw new HidApiError(uploadResponse.status, `Unable to upload ${upload.file_name}.`)
      }

      await edgeRequest('files-register-upload', {
        method: 'POST',
        body: {
          recordId,
          originalFileName: upload.file_name,
          uploadToken: signed.uploadToken,
          mimeType: upload.file_type,
          sizeBytes: blob.size,
        },
      })
    })

    uploadedFileKeys.add(uploadKey)
  }
}

export async function fetchPatientHistory(hidCode: string, options: { forceRefresh?: boolean } = {}): Promise<HistoryView> {
  const cacheKey = `history:${hidCode}`
  if (options.forceRefresh) {
    viewCache.delete(cacheKey)
  }

  return loadCachedView(cacheKey, async () => {
    let history: HidPatientHistoryResponse
    try {
      history = await edgeRequest<HidPatientHistoryResponse>('patient-history-list')
    } catch (error) {
      if (shouldUsePatientHistoryTableFallback(error)) {
        return fetchPatientHistoryFromTables(hidCode)
      }
      throw error
    }

    return {
      pendingRequests: history.pending_requests.map(item => toLegacyAccessRequest(hidCode, item)),
      activeGrants: history.active_grants.map(item => toLegacyAccessRequest(hidCode, item)),
      logs: history.events.map(item => toLegacyAccessLog(hidCode, item)),
    }
  })
}

export async function approveAccessRequest(requestId: string) {
  const response = await edgeRequest<{ grant_id: string; request_id: string }>('access-request-approve', {
    method: 'POST',
    body: {
      requestId,
    },
  })
  invalidateViewCache('history:')
  invalidateViewCache('staff-dashboard:')
  return response
}

export async function denyAccessRequest(requestId: string, reason?: string) {
  const response = await edgeRequest<{ request_id: string; status: string }>('access-request-deny', {
    method: 'POST',
    body: {
      requestId,
      reason: normalizeOptionalText(reason),
    },
  })
  invalidateViewCache('history:')
  invalidateViewCache('staff-dashboard:')
  return response
}

export async function revokeAccessGrant(grantId: string, reason?: string) {
  const response = await edgeRequest<{ grant_id: string; status: string }>('access-grant-revoke', {
    method: 'POST',
    body: {
      grantId,
      reason: normalizeOptionalText(reason),
    },
  })
  invalidateViewCache('history:')
  invalidateViewCache('staff-dashboard:')
  return response
}

export async function patientSignUpWithPassword(params: PendingPatientSignup & { password: string; captchaToken?: string | null }) {
  const normalizedEmail = params.email?.trim().toLowerCase() ?? ''
  const normalizedPhone = normalizeOptionalText(normalizePhone(params.phone ?? ''))
  const pendingData: PendingPatientSignup = {
    email: normalizeOptionalText(normalizedEmail),
    firstName: params.firstName.trim(),
    lastName: params.lastName.trim(),
    gender: normalizeOptionalText(params.gender),
    dob: normalizeOptionalText(params.dob),
    phone: normalizedPhone,
  }

  await assertSignupAvailability({
    accountType: 'patient',
    email: normalizedEmail,
    phone: normalizedPhone,
  })
  await clearConflictingAuthSession(normalizedEmail)

  const redirectTo = authRedirectUrl('patient')
  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password: params.password,
    options: {
      captchaToken: params.captchaToken ?? undefined,
      emailRedirectTo: redirectTo,
      data: {
        pending_patient_signup: pendingData,
        requested_role: 'patient',
      },
    },
  })

  if (error) {
    if (isExistingAccountError(error)) {
      throw new HidApiError(409, 'The information has already been used, Try to sign in.', error)
    }

    throw new HidApiError(400, error.message, error)
  }

  await assertNoSilentSignupConflict({
    accountType: 'patient',
    email: normalizedEmail,
    phone: normalizedPhone,
    user: data.user,
  })

  if (data.session) {
    const profile = await ensurePatientProfileRegistered(pendingData)
    return {
      requiresVerification: false,
      profile,
    }
  }

  return {
    requiresVerification: true,
    profile: null,
  }
}

export async function verifyPatientSignupOtp(email: string, password: string, code: string) {
  await verifySignupOtpAndEnsureSession(email, password, code)
  return ensurePatientProfileRegistered()
}

export async function patientSignIn(identifier: string, password: string, captchaToken?: string | null) {
  const trimmedIdentifier = identifier.trim()
  if (!trimmedIdentifier) {
    throw new HidApiError(400, 'Enter your HID code or email to sign in.')
  }

  const response = await edgeRequest<{ session: HidSessionPayload }>('patient-login', {
    method: 'POST',
    requireAuth: false,
    body: {
      identifier: looksLikeEmailIdentifier(trimmedIdentifier) ? trimmedIdentifier.toLowerCase() : trimmedIdentifier.toUpperCase(),
      password,
      turnstileToken: captchaToken ?? null,
    },
  })

  const { error } = await supabase.auth.setSession({
    access_token: response.session.access_token,
    refresh_token: response.session.refresh_token,
  })

  if (error) {
    throw new HidApiError(
      401,
      isBannedAuthMessage(error.message)
        ? BANNED_ACCOUNT_MESSAGE
        : error.message,
      error
    )
  }

  return ensurePatientProfileRegistered()
}

export async function startPatientPasswordReset(identifier: string, captchaToken?: string | null) {
  const normalizedIdentifier = identifier.trim()
  if (!normalizedIdentifier) {
    throw new HidApiError(400, 'Enter your HID code or email address.')
  }

  return edgeRequest<PasswordResetStartResponse>('patient-reset-start', {
    method: 'POST',
    requireAuth: false,
    body: {
      identifier: looksLikeEmailIdentifier(normalizedIdentifier)
        ? normalizedIdentifier.toLowerCase()
        : normalizedIdentifier.toUpperCase(),
      turnstileToken: captchaToken ?? null,
    },
  })
}

export async function verifyPatientPasswordResetCode(challengeId: string, code: string) {
  return edgeRequest<PasswordResetVerifyResponse>('patient-reset-verify', {
    method: 'POST',
    requireAuth: false,
    body: {
      challengeId,
      code,
    },
  })
}

export async function completePatientPasswordReset(challengeId: string, verificationToken: string, password: string) {
  return edgeRequest<{ challengeId: string; status: string }>('patient-reset-complete', {
    method: 'POST',
    requireAuth: false,
    body: {
      challengeId,
      password,
      verificationToken,
    },
  })
}

export async function updateCurrentUserPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    throw new HidApiError(400, error.message, error)
  }
}

export async function startAccountDeletion() {
  return edgeRequest<AccountDeletionStartResponse>('account-delete-start', {
    method: 'POST',
  })
}

export async function verifyAccountDeletionCode(challengeId: string, code: string) {
  return edgeRequest<AccountDeletionVerifyResponse>('account-delete-verify', {
    method: 'POST',
    body: {
      challengeId,
      code,
    },
  })
}

export async function deleteMyAccount(challengeId: string, verificationToken: string) {
  await edgeRequest<{ deleted: true }>('delete-my-account', {
    method: 'POST',
    body: {
      challengeId,
      verificationToken,
    },
  })

  await resetAuthState()
}

export async function fetchMyStaffAccount() {
  const session = await getSafeSession()
  const userId = session?.user.id
  if (!userId) return null

  return loadCachedView(`staff:${userId}`, async () => {
    const { data, error } = await dataTable('hid_staff_accounts')
      .select(HID_STAFF_ACCOUNT_COLUMNS)
      .eq('auth_user_id', userId)
      .maybeSingle()

    if (error) {
      throw new HidApiError(400, error.message, error)
    }

    const staffAccount = (data as HidStaffAccount | null) ?? null
    if (staffAccount?.deleted_at) {
      await safeSignOut().catch(() => undefined)
      clearAllPortalSessions()
      throw new HidApiError(403, 'This account has been deleted and is no longer available.')
    }

    if (staffAccount?.active === false) {
      await safeSignOut().catch(() => undefined)
      clearAllPortalSessions()
      throw new HidApiError(403, 'This account is locked right now. Contact support if you need help.')
    }

    return staffAccount
  })
}

async function fetchMyStaffAccountWithRetry(attempts = 5, delayMs = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const staffAccount = await fetchMyStaffAccount()
    if (staffAccount) return staffAccount

    if (attempt < attempts - 1) {
      invalidateViewCache('staff:')
      await delay(delayMs * (attempt + 1))
    }
  }

  return null
}

export async function ensureStaffAccountReady(override?: PendingStaffOnboarding) {
  const existing = await fetchMyStaffAccountWithRetry(2, 120)
  if (existing) return existing

  const user = await getSafeUser()
  if (!user) {
    throw new HidApiError(401, 'Please sign in to continue.')
  }

  const pendingData = override ?? (
    isPendingStaffOnboarding(user.user_metadata.pending_staff_onboarding)
      ? user.user_metadata.pending_staff_onboarding
      : null
  )

  if (!pendingData) {
    throw new HidApiError(400, 'Your hospital account setup is incomplete. Complete onboarding again.')
  }

  await edgeRequest('staff-complete-onboarding', {
    method: 'POST',
    body: {
      fullName: pendingData.fullName,
      hospitalName: normalizeOptionalText(pendingData.hospitalName),
      licenseNumber: normalizeOptionalText(pendingData.licenseNumber),
      onboardingType: normalizeOptionalText(pendingData.onboardingType),
      phone: normalizeOptionalText(pendingData.phone),
      country: normalizeOptionalText(pendingData.country),
      state: normalizeOptionalText(pendingData.state),
    },
  })
  await clearPendingMetadata('pending_staff_onboarding')
  invalidateViewCache('staff:')

  const created = await fetchMyStaffAccountWithRetry()
  if (!created) {
    throw new HidApiError(500, 'Your hospital account is still finishing setup. Sign in again in a moment.')
  }

  return created
}

export async function sendPatientVerificationEmail(email: string, captchaToken?: string | null) {
  await requestSignupVerificationEmail(email, 'patient', captchaToken)
}

export async function providerActivateInvite(params: PendingStaffOnboarding & { email: string; password: string; captchaToken?: string | null }) {
  await assertSignupAvailability({
    accountType: 'hospital',
    email: params.email,
  })
  await clearConflictingAuthSession(params.email)

  const pendingData: PendingStaffOnboarding = {
    fullName: params.fullName.trim(),
    licenseNumber: normalizeOptionalText(params.licenseNumber),
    onboardingType: 'staff_invite',
  }

  const redirectTo = authRedirectUrl('hospital')
  const { data, error } = await supabase.auth.signUp({
    email: params.email.trim().toLowerCase(),
    password: params.password,
    options: {
      captchaToken: params.captchaToken ?? undefined,
      emailRedirectTo: redirectTo,
      data: {
        full_name: pendingData.fullName,
        pending_staff_onboarding: pendingData,
        requested_role: 'clinician',
      },
    },
  })

  if (error) {
    throw new HidApiError(400, error.message, error)
  }

  await assertNoSilentSignupConflict({
    accountType: 'hospital',
    email: params.email,
    user: data.user,
  })

  if (data.session) {
    const staffAccount = await ensureStaffAccountReady(pendingData)
    return {
      requiresVerification: false,
      staffAccount,
    }
  }

  return {
    requiresVerification: true,
    staffAccount: null,
  }
}

export async function providerSignUp(params: {
  hospitalName: string
  email: string
  phone?: string
  state: string
  country: string
  password: string
  captchaToken?: string | null
}) {
  const hospitalName = params.hospitalName.trim()
  const normalizedEmail = params.email.trim().toLowerCase()
  await assertSignupAvailability({
    accountType: 'hospital',
    email: normalizedEmail,
  })
  await clearConflictingAuthSession(normalizedEmail)

  const pendingData: PendingStaffOnboarding = {
    country: normalizeOptionalText(params.country),
    fullName: `${hospitalName} Admin`,
    hospitalName,
    onboardingType: 'hospital_signup',
    phone: normalizeOptionalText(normalizePhone(params.phone ?? '')),
    state: normalizeOptionalText(params.state),
  }

  const redirectTo = authRedirectUrl('hospital')
  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password: params.password,
    options: {
      captchaToken: params.captchaToken ?? undefined,
      emailRedirectTo: redirectTo,
      data: {
        full_name: pendingData.fullName,
        pending_staff_onboarding: pendingData,
        requested_role: 'org_admin',
      },
    },
  })

  if (error) {
    if (!isExistingAccountError(error)) {
      throw new HidApiError(400, error.message, error)
    }
    throw new HidApiError(409, 'The information has already been used, Try to sign in.', error)
  }

  await assertNoSilentSignupConflict({
    accountType: 'hospital',
    email: normalizedEmail,
    user: data.user,
  })

  if (data.session) {
    await assertHospitalAccountCompatibleEmail()
    const staffAccount = await ensureStaffAccountReady(pendingData)
    return {
      requiresVerification: false,
      staffAccount,
    }
  }

  return {
    requiresVerification: true,
    staffAccount: null,
  }
}

export async function verifyStaffSignupOtp(email: string, password: string, code: string) {
  await clearConflictingAuthSession(email)
  await verifySignupOtpAndEnsureSession(email, password, code)
  await assertHospitalAccountCompatibleEmail()
  return ensureStaffAccountReady()
}

export async function sendStaffVerificationEmail(email: string, captchaToken?: string | null) {
  await requestSignupVerificationEmail(email, 'hospital', captchaToken)
}

export async function providerSignIn(hospitalName: string, email: string, password: string, captchaToken?: string | null) {
  await clearConflictingAuthSession(email)

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
    options: {
      captchaToken: captchaToken ?? undefined,
    },
  })

  if (error) {
    throw new HidApiError(
      401,
      isBannedAuthMessage(error.message) ? BANNED_ACCOUNT_MESSAGE : error.message,
      error
    )
  }

  await assertHospitalAccountCompatibleEmail()
  const staffAccount = await ensureStaffAccountReady()
  const expectedHospital = normalizeComparableText(hospitalName)
  const actualHospital = normalizeComparableText(staffAccount.hospital_name)

  if (!expectedHospital || !actualHospital || expectedHospital !== actualHospital) {
    await safeSignOut()
    throw new HidApiError(401, 'Invalid hospital credentials.')
  }

  return staffAccount
}

export async function sendStaffPasswordReset(email: string, redirectTo: string, captchaToken?: string | null) {
  void redirectTo
  await requestEmailOtp(email, captchaToken)
}

export async function verifyStaffPasswordResetOtp(email: string, code: string) {
  await verifyEmailOtp(email, code)
  await assertHospitalAccountCompatibleEmail()

  const staffAccount = await fetchMyStaffAccount()
  if (!staffAccount) {
    await safeSignOut().catch(() => undefined)
    clearAllPortalSessions()
    throw new HidApiError(403, 'This email is not linked to a hospital account.')
  }

  return staffAccount
}

export async function startAdminPasswordResetOtp(email: string, captchaToken?: string | null) {
  await requestEmailOtp(email, captchaToken)
}

export async function verifyAdminPasswordResetOtp(email: string, code: string) {
  await verifyEmailOtp(email, code)

  const role = await getCurrentUserAppRole()
  if (role !== 'platform_admin') {
    await safeSignOut().catch(() => undefined)
    clearAllPortalSessions()
    throw new HidApiError(403, 'Admin access is limited to platform admins.')
  }
}

export async function fetchStaffDashboard(options: { forceRefresh?: boolean } = {}) {
  const session = await getSafeSession()
  const authUserId = session?.user?.id ?? null
  if (!authUserId) {
    throw new HidApiError(401, 'Please sign in to continue.')
  }

  if (options.forceRefresh) {
    viewCache.delete(`staff-dashboard:${authUserId}`)
  }

  return loadCachedView(`staff-dashboard:${authUserId}`, async () => edgeRequest<HidStaffDashboardResponse>('staff-dashboard'))
}

export async function createAccessRequest(patientIdentifier: string, reason: string, durationMinutes = 60, staffDisplayName?: string | null) {
  const response = await edgeRequest<{ request_id: string; patient_id: string }>('access-request-create', {
    method: 'POST',
    body: {
      patientIdentifier,
      scope: 'write_records',
      reason,
      durationMinutes,
      staffDisplayName: normalizeOptionalText(staffDisplayName),
    },
  })
  invalidateViewCache('history:')
  invalidateViewCache('staff-dashboard:')
  return response
}

export async function accessPatientWithPin(patientIdentifier: string, accessPin: string, durationMinutes = 60, staffDisplayName?: string | null) {
  const response = await edgeRequest<{ request_id: string | null; grant_id: string; patient_id: string }>('access-request-create', {
    method: 'POST',
    body: {
      patientIdentifier,
      accessPin,
      durationMinutes,
      staffDisplayName: normalizeOptionalText(staffDisplayName),
    },
  })
  invalidateViewCache('history:')
  invalidateViewCache('records:')
  invalidateViewCache('staff-dashboard:')
  return response
}

export async function breakGlassAccess(patientIdentifier: string, reason: string, durationMinutes = 30, staffDisplayName?: string | null) {
  const response = await edgeRequest<{ request_id: string; grant_id: string }>('break-glass', {
    method: 'POST',
    body: {
      patientIdentifier,
      reason,
      durationMinutes,
      staffDisplayName: normalizeOptionalText(staffDisplayName),
    },
  })
  invalidateViewCache('history:')
  invalidateViewCache('records:')
  invalidateViewCache('staff-dashboard:')
  return response
}

export async function closeMyAccessGrant(grantId: string, reason?: string) {
  const response = await edgeRequest<{ grant_id: string; status: string }>('access-grant-close', {
    method: 'POST',
    body: {
      grantId,
      reason: normalizeOptionalText(reason),
    },
  })
  invalidateViewCache('history:')
  invalidateViewCache('records:')
  invalidateViewCache('staff-dashboard:')
  return response
}

export async function syncSessionFromRecovery(session: Session | null) {
  if (!session) return
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })

  if (error) {
    throw new HidApiError(400, error.message, error)
  }
}
