import { Session } from '@supabase/supabase-js'
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

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function callEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY

  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({ error: 'Unexpected response from server.' }))
  if (!res.ok) {
    throw new Error(json?.error ?? 'Something went wrong. Please try again.')
  }
  return json.data as T
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

export async function loginOutreachWorker(email: string, password: string): Promise<OutreachWorker> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    if (error.message?.toLowerCase().includes('invalid login credentials')) {
      throw new Error("We couldn't find an outreach account with those details. Check your email and password and try again.")
    }
    throw new Error(error.message ?? 'Sign-in failed. Please try again.')
  }

  const userId = data.session?.user.id
  if (!userId) throw new Error('Sign-in failed. Please try again.')

  const { data: worker } = await supabase
    .from('hid_outreach_workers')
    .select('*')
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
    .select('*')
    .eq('auth_user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data as OutreachWorker | null
}

export async function fetchOutreachCampaigns(campaignId?: string): Promise<OutreachCampaign[]> {
  let query = supabase.from('hid_outreach_campaigns').select('*')
  if (campaignId) {
    query = query.eq('id', campaignId)
  }
  const { data, error } = await query.order('starts_at', { ascending: false })
  if (error) {
    throw new Error(error.message)
  }
  return data as OutreachCampaign[]
}

export async function fetchOutreachEncounters(campaignId: string): Promise<OutreachEncounter[]> {
  const { data, error } = await supabase
    .from('hid_outreach_encounters')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data as OutreachEncounter[]
}

export async function fetchOutreachSyncQueue(campaignId: string): Promise<OutreachSyncQueueItem[]> {
  const { data, error } = await supabase
    .from('hid_sync_queue')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
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
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
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
    .select('*')
    .single()
  if (error) throw new Error(error.message)
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
    .select('*')
    .single()
  if (error) throw new Error(error.message)
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
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as OutreachInvite
}

export async function fetchCampaignInvite(campaignId: string, workerId: string): Promise<OutreachInvite | null> {
  const { data } = await supabase
    .from('hid_outreach_invites')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('created_by', workerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as OutreachInvite | null
}

export async function fetchInviteByCode(rawCode: string): Promise<OutreachInvite | null> {
  const code = rawCode.replace(/-/g, '').toUpperCase()
  const { data, error } = await supabase
    .from('hid_outreach_invites')
    .select('*')
    .eq('code', code)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as OutreachInvite | null
}

export async function fetchCampaignById(id: string): Promise<OutreachCampaign | null> {
  const { data, error } = await supabase
    .from('hid_outreach_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as OutreachCampaign | null
}

export async function incrementInviteUseCount(inviteId: string): Promise<void> {
  const { data } = await supabase
    .from('hid_outreach_invites')
    .select('use_count')
    .eq('id', inviteId)
    .single()
  if (!data) return
  await (supabase.from('hid_outreach_invites') as any)
    .update({ use_count: (data as { use_count: number }).use_count + 1 })
    .eq('id', inviteId)
}

export async function markSyncQueueAsSynced(campaignId: string): Promise<void> {
  const { error } = await (supabase
    .from('hid_sync_queue') as any)
    .update({ status: 'synced', synced_at: new Date().toISOString() })
    .eq('campaign_id', campaignId)
    .eq('status', 'queued')

  if (error) {
    throw new Error(error.message)
  }
}
