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
import { fetchWithTimeout, NETWORK_TIMEOUT_MESSAGE, supabase } from './supabase'

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
}

type SignedDownloadResponse = {
  signedUrl: string
}

type PasswordResetStartResponse = {
  challengeId: string
  deliveryChannels: Array<'email'>
  expiresAt: string
  hidCode: string
  maskedEmail: string | null
}

type PasswordResetVerifyResponse = {
  challengeId: string
  verificationToken: string
}

type RecordCreationResponse = {
  record_id: string
  version_id: string
}

type HistoryView = {
  pendingRequests: AccessRequest[]
  activeGrants: AccessRequest[]
  logs: AccessLog[]
}

const RECORD_FILE_BUCKET = 'medical-record-files'
const VIEW_CACHE_TTL_MS = 12000
const inflightRecordSaves = new Map<string, Promise<RecordCreationResponse>>()

type ViewCacheEntry<T> = {
  expiresAt: number
  promise?: Promise<T>
  value?: T
}

const viewCache = new Map<string, ViewCacheEntry<unknown>>()

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
  const { data } = await supabase.auth.getUser()
  const currentUser = data.user

  if (!currentUser) return

  const currentEmail = currentUser.email?.trim().toLowerCase() ?? null
  if (normalizedTargetEmail && currentEmail === normalizedTargetEmail) return

  await supabase.auth.signOut()
  clearAllPortalSessions()
}

async function assertHospitalAccountCompatibleEmail() {
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) return

  const requestedRole = `${user.user_metadata.requested_role ?? ''}`.trim().toLowerCase()
  const hasPendingPatientSignup = isPendingPatientSignup(user.user_metadata.pending_patient_signup)
  const hasPendingStaffOnboarding = isPendingStaffOnboarding(user.user_metadata.pending_staff_onboarding)

  if (requestedRole === 'patient' && !hasPendingStaffOnboarding) {
    await supabase.auth.signOut()
    clearAllPortalSessions()
    throw new HidApiError(
      409,
      hasPendingPatientSignup
        ? 'This email is already linked to a patient account. Use a different email for the hospital account.'
        : 'This email cannot be used for a hospital account. Use a different email address.'
    )
  }
}

function isEmailNotConfirmedError(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.message.toLowerCase().includes('email not confirmed')
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isExistingAccountError(error: unknown) {
  if (!(error instanceof Error)) return false
  const lower = error.message.toLowerCase()
  return lower.includes('already registered') || lower.includes('already exists')
}

function isPatientProfileConflictError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; message?: string }
  const lower = `${candidate.message ?? ''}`.toLowerCase()
  return candidate.code === '23505' || lower.includes('duplicate key') || lower.includes('idx_hid_patients_phone') || lower.includes('idx_hid_patients_email')
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

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

async function resetAuthState() {
  try {
    await supabase.auth.signOut()
  } catch {
    // Best effort only.
  }
  clearAllPortalSessions()
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
    const responseMessage = rawResponseMessage && !isLowSignalErrorMessage(rawResponseMessage)
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
  const { data } = await supabase.auth.getUser()
  const user = data.user
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

async function getCurrentUserAppRole() {
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) return null

  const { data: profile, error } = await supabase
    .from('hid_user_profiles')
    .select('app_role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (error) {
    throw new HidApiError(400, error.message, error)
  }

  const role = (profile as { app_role?: unknown } | null)?.app_role
  return typeof role === 'string' ? role : null
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

async function bestEffortRequestSignupVerificationEmail(email: string, path: 'patient' | 'hospital', captchaToken?: string | null) {
  try {
    await requestSignupVerificationEmail(email, path, captchaToken)
    return true
  } catch {
    return false
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
      throw new HidApiError(401, signInError.message, signInError)
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
  return edgeRequest<SignedDownloadResponse>('files-sign-download', {
    method: 'POST',
    body: { fileId },
  })
}

async function toLegacyRecordFiles(files: HidPatientRecordsResponse['records'][number]['files']): Promise<MedicalRecordFile[]> {
  const resolvedFiles = await Promise.all(files.map(async file => {
    try {
      const signed = await signRecordDownload(file.id)
      return {
        id: file.id,
        record_id: file.record_id,
        file_name: file.original_file_name,
        file_type: file.mime_type,
        file_data_url: signed.signedUrl,
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
  const response = await fetchWithTimeout(dataUrl)
  return response.blob()
}

function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
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

  const { data } = await supabase.auth.getUser()
  const user = data.user
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
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) {
    throw new HidApiError(401, 'Please sign in to continue.')
  }

  return loadCachedView(`patient:${user.id}`, async () => {
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
    .select('*')
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

export async function countUnreadNotifications() {
  const { count, error } = await dataTable('hid_notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)

  if (error) {
    throw new HidApiError(400, error.message, error)
  }

  return count ?? 0
}

export async function listNotifications(hidCode: string) {
  const { data, error } = await dataTable('hid_notifications')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    throw new HidApiError(400, error.message, error)
  }

  return ((data as HidNotification[] | null) ?? []).map(item => toLegacyNotification(item, hidCode))
}

export async function listUnreadNotifications(hidCode: string, limit = 20) {
  const { data, error } = await dataTable('hid_notifications')
    .select('*')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new HidApiError(400, error.message, error)
  }

  return ((data as HidNotification[] | null) ?? []).map(item => toLegacyNotification(item, hidCode))
}

export async function markNotificationRead(id: string) {
  const { error } = await dataTable('hid_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    throw new HidApiError(400, error.message, error)
  }
}

export async function markAllNotificationsRead() {
  const { error } = await dataTable('hid_notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)

  if (error) {
    throw new HidApiError(400, error.message, error)
  }
}

export async function fetchPatientRecordsView(patientIdentifier?: string) {
  const cacheKey = `records:${patientIdentifier ?? 'self'}`

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
  })
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
  const normalizedNotes = normalizeOptionalText(notes)
  const uploadsFingerprint = (uploads ?? [])
    .map(upload => `${upload.file_name}:${upload.file_type ?? ''}:${upload.file_data_url.length}`)
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

    if (uploads && uploads.length > 0) {
      await uploadRecordFiles(created.record_id, uploads)
    }

    invalidateViewCache('records:')
    invalidateViewCache('history:')
    invalidateViewCache('staff-dashboard:')
    return created
  })()

  inflightRecordSaves.set(requestKey, request)

  try {
    return await request
  } finally {
    inflightRecordSaves.delete(requestKey)
  }
}

export async function uploadRecordFiles(recordId: string, uploads: UploadDraft[]) {
  await Promise.all(uploads.map(async upload => {
    const signed = await edgeRequest<SignedUploadResponse>('files-sign-upload', {
      method: 'POST',
      body: {
        recordId,
        fileName: upload.file_name,
      },
    })

    const blob = await dataUrlToBlob(upload.file_data_url)
    const uploadResponse = await fetchWithTimeout(signed.signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': upload.file_type ?? 'application/octet-stream',
      },
      body: blob,
    })

    if (!uploadResponse.ok) {
      throw new HidApiError(uploadResponse.status, `Unable to upload ${upload.file_name}.`)
    }

    await edgeRequest('files-register-upload', {
      method: 'POST',
      body: {
        recordId,
        storagePath: signed.path,
        originalFileName: upload.file_name,
        mimeType: upload.file_type,
        sizeBytes: blob.size,
      },
    })
  }))
}

export async function fetchPatientHistory(hidCode: string): Promise<HistoryView> {
  return loadCachedView(`history:${hidCode}`, async () => {
    const history = await edgeRequest<HidPatientHistoryResponse>('patient-history-list')

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
  const pendingData: PendingPatientSignup = {
    email: normalizeOptionalText(normalizedEmail),
    firstName: params.firstName.trim(),
    lastName: params.lastName.trim(),
    gender: normalizeOptionalText(params.gender),
    dob: normalizeOptionalText(params.dob),
    phone: normalizeOptionalText(normalizePhone(params.phone ?? '')),
  }

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
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: params.password,
        options: {
          captchaToken: params.captchaToken ?? undefined,
        },
      })

      if (!signInError) {
        const profile = await ensurePatientProfileRegistered(pendingData)
        return {
          requiresVerification: false,
          profile,
        }
      }

      if (isEmailNotConfirmedError(signInError)) {
        await bestEffortRequestSignupVerificationEmail(normalizedEmail, 'patient', params.captchaToken)
        return {
          requiresVerification: true,
          profile: null,
        }
      }

      throw new HidApiError(409, 'An account with this email already exists. Sign in instead.', error)
    }

    throw new HidApiError(400, error.message, error)
  }

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
    throw new HidApiError(401, error.message, error)
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

export async function fetchMyStaffAccount() {
  const { data: authData } = await supabase.auth.getUser()
  const user = authData.user
  if (!user) return null

  return loadCachedView(`staff:${user.id}`, async () => {
    const { data, error } = await dataTable('hid_staff_accounts')
      .select('*')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (error) {
      throw new HidApiError(400, error.message, error)
    }

    return (data as HidStaffAccount | null) ?? null
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

  const { data } = await supabase.auth.getUser()
  const user = data.user
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

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: params.password,
      options: {
        captchaToken: params.captchaToken ?? undefined,
      },
    })

    if (signInError) {
      if (isEmailNotConfirmedError(signInError)) {
        await bestEffortRequestSignupVerificationEmail(normalizedEmail, 'hospital', params.captchaToken)
        return {
          requiresVerification: true,
          staffAccount: null,
        }
      }
      throw new HidApiError(409, 'An account with this email already exists. Sign in instead.', error)
    }

    await assertHospitalAccountCompatibleEmail()
    const staffAccount = await ensureStaffAccountReady(pendingData)
    const expectedHospital = normalizeComparableText(pendingData.hospitalName)
    const actualHospital = normalizeComparableText(staffAccount.hospital_name)

    if (expectedHospital && actualHospital && expectedHospital !== actualHospital) {
      await supabase.auth.signOut()
      throw new HidApiError(409, error.message, error)
    }

    return {
      requiresVerification: false,
      staffAccount,
    }
  }

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
    throw new HidApiError(401, error.message, error)
  }

  await assertHospitalAccountCompatibleEmail()
  const staffAccount = await ensureStaffAccountReady()
  const expectedHospital = normalizeComparableText(hospitalName)
  const actualHospital = normalizeComparableText(staffAccount.hospital_name)

  if (!expectedHospital || !actualHospital || expectedHospital !== actualHospital) {
    await supabase.auth.signOut()
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
    await supabase.auth.signOut().catch(() => undefined)
    clearAllPortalSessions()
    throw new HidApiError(403, 'This email is not linked to a hospital account.')
  }

  return staffAccount
}

export async function startAdminPasswordResetOtp(email: string) {
  await requestEmailOtp(email, null)
}

export async function verifyAdminPasswordResetOtp(email: string, code: string) {
  await verifyEmailOtp(email, code)

  const role = await getCurrentUserAppRole()
  if (role !== 'platform_admin') {
    await supabase.auth.signOut().catch(() => undefined)
    clearAllPortalSessions()
    throw new HidApiError(403, 'Admin access is limited to platform admins.')
  }
}

export async function fetchStaffDashboard() {
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) {
    throw new HidApiError(401, 'Please sign in to continue.')
  }

  return loadCachedView(`staff-dashboard:${user.id}`, async () => edgeRequest<HidStaffDashboardResponse>('staff-dashboard'))
}

export async function createAccessRequest(patientIdentifier: string, reason: string, durationMinutes = 60) {
  const response = await edgeRequest<{ request_id: string; patient_id: string }>('access-request-create', {
    method: 'POST',
    body: {
      patientIdentifier,
      scope: 'write_records',
      reason,
      durationMinutes,
    },
  })
  invalidateViewCache('history:')
  invalidateViewCache('staff-dashboard:')
  return response
}

export async function accessPatientWithPin(patientIdentifier: string, accessPin: string, durationMinutes = 60) {
  const response = await edgeRequest<{ request_id: string | null; grant_id: string; patient_id: string }>('access-request-create', {
    method: 'POST',
    body: {
      patientIdentifier,
      accessPin,
      durationMinutes,
    },
  })
  invalidateViewCache('history:')
  invalidateViewCache('records:')
  invalidateViewCache('staff-dashboard:')
  return response
}

export async function breakGlassAccess(patientIdentifier: string, reason: string, durationMinutes = 30) {
  const response = await edgeRequest<{ request_id: string; grant_id: string }>('break-glass', {
    method: 'POST',
    body: {
      patientIdentifier,
      reason,
      durationMinutes,
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
