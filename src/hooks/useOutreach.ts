import { useEffect, useMemo, useState } from 'react'
import { getSafeSession, safeSignOut } from '../lib/supabase'
import {
  createOutreachEncounter,
  fetchOutreachCampaigns,
  fetchOutreachEncounters,
  fetchOutreachSyncQueue,
  fetchOutreachWorker,
  markSyncQueueAsSynced,
} from '../lib/outreachApi'
import type { NewEncounterInput, OutreachCampaign, OutreachEncounter, OutreachSyncQueueItem, OutreachWorker } from '../types/outreach'

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

  const activeCampaignId = activeCampaign?.id ?? null

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
          const [encounterRows, syncRows] = await Promise.all([
            fetchOutreachEncounters(campaign.id),
            fetchOutreachSyncQueue(campaign.id),
          ])
          if (!mounted) return
          setEncounters(encounterRows)
          setSyncQueue(syncRows)
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
    return {
      registered: encounters.length,
      queued,
      served,
      referred,
    }
  }, [encounters, syncQueue, activeCampaign])

  async function addEncounter(input: NewEncounterInput) {
    if (!worker || !activeCampaign) {
      throw new Error('Outreach campaign is not ready.')
    }
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
    const updatedQueue = await fetchOutreachSyncQueue(activeCampaign.id)
    setSyncQueue(updatedQueue)
    setConnection('online')
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
    addEncounter,
    simulateSync,
    signOut,
  }
}
