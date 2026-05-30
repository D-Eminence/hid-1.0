import { useEffect, useMemo, useState } from 'react'
import { getSafeSession, safeSignOut } from '../lib/supabase'
import {
  createInviteCode,
  createOutreachEncounter,
  fetchCampaignInvite,
  fetchOutreachCampaigns,
  fetchOutreachEncounters,
  fetchOutreachSyncQueue,
  fetchOutreachWorker,
  markSyncQueueAsSynced,
} from '../lib/outreachApi'
import type {
  NewEncounterInput,
  OutreachCampaign,
  OutreachEncounter,
  OutreachInvite,
  OutreachSyncQueueItem,
  OutreachWorker,
} from '../types/outreach'

export function useOutreach() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [worker, setWorker] = useState<OutreachWorker | null>(null)
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([])
  const [activeCampaign, setActiveCampaign] = useState<OutreachCampaign | null>(null)
  const [encounters, setEncounters] = useState<OutreachEncounter[]>([])
  const [syncQueue, setSyncQueue] = useState<OutreachSyncQueueItem[]>([])
  const [connection, setConnection] = useState<'online' | 'offline'>('online')
  const [invite, setInvite] = useState<OutreachInvite | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const session = await getSafeSession()
        const userId = session?.user.id
        if (!userId) {
          if (mounted) setNeedsAuth(true)
          return
        }

        const [workerRecord, allCampaigns] = await Promise.all([
          fetchOutreachWorker(userId),
          fetchOutreachCampaigns(),
        ])

        if (!mounted) return

        if (!workerRecord) {
          throw new Error('You are not assigned to an outreach campaign. Contact your administrator.')
        }

        const campaign = allCampaigns.find((item) => item.id === workerRecord.campaign_id) ?? null

        setWorker(workerRecord)
        setCampaigns(allCampaigns)
        setActiveCampaign(campaign)

        if (campaign) {
          const requests: Promise<any>[] = [
            fetchOutreachEncounters(campaign.id),
            fetchOutreachSyncQueue(campaign.id),
          ]
          if (workerRecord.role === 'admin') {
            requests.push(fetchCampaignInvite(campaign.id, workerRecord.id))
          }
          const [encounterRows, syncRows, existingInvite] = await Promise.all(requests)
          if (!mounted) return
          setEncounters(encounterRows)
          setSyncQueue(syncRows)
          if (workerRecord.role === 'admin') setInvite(existingInvite ?? null)
        }
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : 'Unable to load outreach workspace.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void load()
    return () => {
      mounted = false
    }
  }, [])

  const role = worker?.role ?? 'enumerator'

  const metrics = useMemo(() => {
    if (!activeCampaign) return { registered: 0, queued: 0, served: 0, referred: 0 }
    const queued = syncQueue.filter((item) => item.status !== 'synced').length
    const served = encounters.filter((encounter) => encounter.status === 'synced' || encounter.status === 'referred').length
    const referred = encounters.filter((encounter) => encounter.status === 'referred' || encounter.service_type === 'referral').length
    return { registered: encounters.length, queued, served, referred }
  }, [encounters, syncQueue, activeCampaign])

  async function addEncounter(input: NewEncounterInput) {
    if (!worker || !activeCampaign) throw new Error('Outreach campaign is not ready.')
    const encounter = await createOutreachEncounter(worker, activeCampaign.id, input)
    setEncounters((current) => [encounter, ...current])
    await markSyncQueueAsSynced(activeCampaign.id)
    setSyncQueue(await fetchOutreachSyncQueue(activeCampaign.id))
  }

  async function simulateSync() {
    if (!activeCampaign) return
    setConnection('offline')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await markSyncQueueAsSynced(activeCampaign.id)
    setSyncQueue(await fetchOutreachSyncQueue(activeCampaign.id))
    setConnection('online')
  }

  async function generateInvite() {
    if (!worker || !activeCampaign) return
    const newInvite = await createInviteCode(worker.id, activeCampaign.id, 'enumerator')
    setInvite(newInvite)
  }

  async function signOut() {
    await safeSignOut()
  }

  return {
    loading,
    error,
    needsAuth,
    worker,
    campaigns,
    activeCampaign,
    encounters,
    syncQueue,
    connection,
    role,
    metrics,
    invite,
    addEncounter,
    simulateSync,
    generateInvite,
    signOut,
  }
}
