import { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Database } from '../types/database'
import type {
  NewEncounterInput,
  OutreachCampaign,
  OutreachEncounter,
  OutreachSyncQueueItem,
  OutreachWorker,
} from '../types/outreach'

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
