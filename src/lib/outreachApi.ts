import { Session } from '@supabase/supabase-js'
import { createApiRequestId, readFunctionInvokeError, unwrapApiData } from './apiResponse'
import { supabase } from './supabase'
import type { Database } from '../types/database'
import type {
  NewEncounterInput,
  OutreachCampaign,
  OutreachEncounter,
  OutreachInvite,
  OutreachRole,
  OutreachSyncQueueItem,
  OutreachWorker,
} from '../types/outreach'

const OUTREACH_CAMPAIGN_COLUMNS = 'id, name, org, location, status, starts_at, ends_at, services, created_at'
const OUTREACH_ENCOUNTER_COLUMNS = 'id, campaign_id, worker_id, patient_hid, provisional_patient_id, full_name, sex, age_years, phone, service_type, status, notes, consent_captured_at, consent_method, created_at, synced_at'
const OUTREACH_INVITE_COLUMNS = 'id, campaign_id, created_by, code, role, max_uses, use_count, expires_at, created_at'
const OUTREACH_SYNC_QUEUE_COLUMNS = 'id, campaign_id, worker_id, entity, action, payload, status, error, created_at, synced_at'
const OUTREACH_WORKER_COLUMNS = 'id, auth_user_id, campaign_id, display_name, role, created_at'

export class OutreachApiError extends Error {
  status: number
  code: string | null
  requestId: string | null
  retryable: boolean
  details: unknown

  constructor(
    message: string,
    options: {
      status?: number
      code?: string | null
      requestId?: string | null
      retryable?: boolean
      details?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'OutreachApiError'
    this.status = options.status ?? 500
    this.code = options.code ?? null
    this.requestId = options.requestId ?? null
    this.retryable = options.retryable ?? this.status >= 500
    this.details = options.details ?? null
  }
}

function outreachDataError(error: unknown, fallbackMessage: string) {
  const candidate = error && typeof error === 'object' ? error as Record<string, unknown> : null
  const rawMessage = error instanceof Error
    ? error.message
    : typeof candidate?.message === 'string'
      ? candidate.message
      : ''
  const lower = rawMessage.toLowerCase()
  const rawCode = typeof candidate?.code === 'string' ? candidate.code.toUpperCase() : ''

  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('timed out')) {
    return new OutreachApiError('We could not reach the service right now. Check your connection and try again.', {
      status: 503,
      code: 'NETWORK_ERROR',
      retryable: true,
      details: error,
    })
  }
  if (lower.includes('jwt') || lower.includes('refresh token') || lower.includes('not authenticated')) {
    return new OutreachApiError('Your session has expired. Please sign in again.', {
      status: 401,
      code: 'AUTH_REQUIRED',
      retryable: false,
      details: error,
    })
  }
  if (rawCode === '23505' || lower.includes('duplicate key')) {
    return new OutreachApiError('That information is already in use. Review it and try again.', {
      status: 409,
      code: 'CONFLICT',
      retryable: false,
      details: error,
    })
  }
  if (rawCode === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return new OutreachApiError('This account is not allowed to perform that action.', {
      status: 403,
      code: 'FORBIDDEN',
      retryable: false,
      details: error,
    })
  }

  return new OutreachApiError(fallbackMessage, {
    status: 500,
    code: 'DATA_REQUEST_FAILED',
    retryable: true,
    details: error,
  })
}

async function callEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  let result: { data: unknown; error: unknown }
  const requestId = createApiRequestId()

  try {
    result = await supabase.functions.invoke(name, {
      body: body as Record<string, unknown>,
      headers: {
        'X-Request-ID': requestId,
      },
    })
  } catch (error) {
    throw new OutreachApiError("We're having trouble connecting right now. Please check your internet connection and try again.", {
      status: 503,
      code: 'NETWORK_ERROR',
      requestId,
      retryable: true,
      details: error,
    })
  }

  if (result.error) {
    const errorInfo = await readFunctionInvokeError(result.error, 'Something went wrong on our end. Please try again in a moment.')
    const lower = errorInfo.message.toLowerCase()
    const message = !errorInfo.message ||
      lower.includes('failed to fetch') ||
      lower.includes('edge function returned') ||
      lower.includes('supabase')
      ? 'Something went wrong on our end. Please try again in a moment.'
      : errorInfo.message

    throw new OutreachApiError(message, {
      status: errorInfo.status,
      code: errorInfo.code,
      requestId: errorInfo.requestId ?? requestId,
      retryable: errorInfo.retryable,
      details: errorInfo.details,
    })
  }

  const unwrapped = unwrapApiData<T>(result.data)
  return (unwrapped.found ? unwrapped.value : result.data) as T
}

export type OutreachSignupPayload = {
  email: string
  password: string
  displayName: string
  campaignName: string
  org: string
  location: string
  startsAt: string
}

export type OutreachSignupResult = {
  otpId: string
  maskedEmail: string
  expiresAt: string
  expiresInMinutes: number
}

export type OutreachVerifyResult = {
  session: { access_token: string; refresh_token: string; expires_in: number; token_type: string }
  worker: OutreachWorker
  campaign: OutreachCampaign
}

export type OutreachResendResult = {
  maskedEmail: string
  expiresAt: string
  expiresInMinutes: number
  resendsRemaining: number
}

export async function signupOutreachAdmin(payload: OutreachSignupPayload): Promise<OutreachSignupResult> {
  return callEdgeFunction<OutreachSignupResult>('outreach-signup', payload)
}

export async function verifyOutreachOtp(otpId: string, code: string): Promise<OutreachVerifyResult> {
  return callEdgeFunction<OutreachVerifyResult>('outreach-verify-otp', { otpId, code })
}

export async function resendOutreachOtp(otpId: string): Promise<OutreachResendResult> {
  return callEdgeFunction<OutreachResendResult>('outreach-resend-otp', { otpId })
}

export type OutreachJoinResult = {
  session: { access_token: string; refresh_token: string; expires_in: number; token_type: string }
  worker: OutreachWorker
}

export async function joinWithInviteCode(
  code: string,
  email: string,
  password: string,
  displayName: string
): Promise<OutreachJoinResult> {
  return callEdgeFunction<OutreachJoinResult>('outreach-join', { code, email, password, displayName })
}

export async function loginOutreachWorker(email: string, password: string): Promise<OutreachWorker> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    if (error.message?.toLowerCase().includes('invalid login credentials')) {
      throw new Error("We couldn't find an outreach account with those details. Check your email and password and try again.")
    }
    throw outreachDataError(error, 'Outreach sign-in could not be completed right now. Please try again.')
  }

  const userId = data.session?.user.id
  if (!userId) throw new Error('Sign-in failed. Please try again.')

  const { data: worker } = await supabase
    .from('hid_outreach_workers')
    .select(OUTREACH_WORKER_COLUMNS)
    .eq('auth_user_id', userId)
    .maybeSingle()

  if (!worker) {
    await supabase.auth.signOut()
    throw new Error("You don't have an outreach account linked to this email. Check your email or sign up to create one.")
  }

  return worker as OutreachWorker
}

export function getCurrentUserId(session: Session | null) {
  return session?.user.id ?? null
}

export async function fetchOutreachWorker(userId: string): Promise<OutreachWorker | null> {
  const { data, error } = await supabase
    .from('hid_outreach_workers')
    .select(OUTREACH_WORKER_COLUMNS)
    .eq('auth_user_id', userId)
    .maybeSingle()

  if (error) {
    throw outreachDataError(error, 'Your outreach profile could not be loaded right now.')
  }

  return data as OutreachWorker | null
}

export async function fetchOutreachCampaigns(campaignId?: string): Promise<OutreachCampaign[]> {
  let query = supabase.from('hid_outreach_campaigns').select(OUTREACH_CAMPAIGN_COLUMNS)
  if (campaignId) {
    query = query.eq('id', campaignId)
  }
  const { data, error } = await query.order('starts_at', { ascending: false })
  if (error) {
    throw outreachDataError(error, 'Outreach campaigns could not be loaded right now.')
  }
  return data as OutreachCampaign[]
}

export async function fetchOutreachEncounters(campaignId: string): Promise<OutreachEncounter[]> {
  const { data, error } = await supabase
    .from('hid_outreach_encounters')
    .select(OUTREACH_ENCOUNTER_COLUMNS)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })

  if (error) {
    throw outreachDataError(error, 'Outreach encounters could not be loaded right now.')
  }

  return data as OutreachEncounter[]
}

export async function fetchOutreachSyncQueue(campaignId: string): Promise<OutreachSyncQueueItem[]> {
  const { data, error } = await supabase
    .from('hid_sync_queue')
    .select(OUTREACH_SYNC_QUEUE_COLUMNS)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })

  if (error) {
    throw outreachDataError(error, 'The outreach sync queue could not be loaded right now.')
  }

  return data as OutreachSyncQueueItem[]
}

export async function createOutreachEncounter(
  worker: OutreachWorker,
  campaignId: string,
  payload: NewEncounterInput
): Promise<OutreachEncounter> {
  const { data, error } = await (supabase
    .from('hid_outreach_encounters') as any)
    .insert({
      campaign_id: campaignId,
      worker_id: worker.id,
      full_name: payload.full_name,
      sex: payload.sex,
      age_years: payload.age_years,
      phone: payload.phone ?? null,
      service_type: payload.service_type,
      notes: payload.notes ?? null,
      consent_method: payload.consent_method ?? null,
      status: 'queued',
    })
    .select(OUTREACH_ENCOUNTER_COLUMNS)
    .single()

  if (error) {
    throw outreachDataError(error, 'The outreach encounter could not be saved right now.')
  }

  return data as OutreachEncounter
}

export async function createOutreachCampaign(
  name: string,
  org: string,
  location: string,
  startsAt: string
): Promise<OutreachCampaign> {
  const { data, error } = await (supabase.from('hid_outreach_campaigns') as any)
    .insert({ name, org, location, starts_at: startsAt, status: 'planned', services: ['registration'] })
    .select(OUTREACH_CAMPAIGN_COLUMNS)
    .single()
  if (error) throw outreachDataError(error, 'The outreach campaign could not be created right now.')
  return data as OutreachCampaign
}

export async function createOutreachWorker(
  authUserId: string,
  campaignId: string,
  displayName: string,
  role: OutreachRole
): Promise<OutreachWorker> {
  const { data, error } = await (supabase.from('hid_outreach_workers') as any)
    .insert({ auth_user_id: authUserId, campaign_id: campaignId, display_name: displayName, role })
    .select(OUTREACH_WORKER_COLUMNS)
    .single()
  if (error) throw outreachDataError(error, 'The outreach worker could not be created right now.')
  return data as OutreachWorker
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export async function createInviteCode(
  workerId: string,
  campaignId: string,
  role: OutreachRole
): Promise<OutreachInvite> {
  const code = generateCode()
  const { data, error } = await (supabase.from('hid_outreach_invites') as any)
    .insert({ campaign_id: campaignId, created_by: workerId, code, role, max_uses: 50 })
    .select(OUTREACH_INVITE_COLUMNS)
    .single()
  if (error) throw outreachDataError(error, 'The outreach invite could not be created right now.')
  return data as OutreachInvite
}

export async function fetchCampaignInvite(campaignId: string, workerId: string): Promise<OutreachInvite | null> {
  const { data, error } = await supabase
    .from('hid_outreach_invites')
    .select(OUTREACH_INVITE_COLUMNS)
    .eq('campaign_id', campaignId)
    .eq('created_by', workerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw outreachDataError(error, 'The outreach invite could not be loaded right now.')
  return data as OutreachInvite | null
}

export async function fetchInviteByCode(rawCode: string): Promise<OutreachInvite | null> {
  const code = rawCode.replace(/-/g, '').toUpperCase()
  const { data, error } = await supabase
    .from('hid_outreach_invites')
    .select(OUTREACH_INVITE_COLUMNS)
    .eq('code', code)
    .maybeSingle()
  if (error) throw outreachDataError(error, 'The outreach invite could not be verified right now.')
  return data as OutreachInvite | null
}

export async function fetchCampaignById(id: string): Promise<OutreachCampaign | null> {
  const { data, error } = await supabase
    .from('hid_outreach_campaigns')
    .select(OUTREACH_CAMPAIGN_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw outreachDataError(error, 'The outreach campaign could not be loaded right now.')
  return data as OutreachCampaign | null
}

export async function incrementInviteUseCount(inviteId: string): Promise<void> {
  const { data, error } = await supabase
    .from('hid_outreach_invites')
    .select('use_count')
    .eq('id', inviteId)
    .single()
  if (error) throw outreachDataError(error, 'The outreach invite could not be updated right now.')
  if (!data) return
  const update = await (supabase.from('hid_outreach_invites') as any)
    .update({ use_count: (data as { use_count: number }).use_count + 1 })
    .eq('id', inviteId)
  if (update.error) throw outreachDataError(update.error, 'The outreach invite could not be updated right now.')
}

export async function markSyncQueueAsSynced(campaignId: string): Promise<void> {
  const { error } = await (supabase
    .from('hid_sync_queue') as any)
    .update({ status: 'synced', synced_at: new Date().toISOString() })
    .eq('campaign_id', campaignId)
    .eq('status', 'queued')

  if (error) {
    throw outreachDataError(error, 'The outreach sync queue could not be updated right now.')
  }
}
