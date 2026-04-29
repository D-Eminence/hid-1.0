import { supabase } from './supabase'

type AccessRealtimeTable =
  | 'hid_access_requests'
  | 'hid_access_grants'
  | 'hid_audit_events'
  | 'hid_medical_records'
  | 'hid_medical_record_versions'
  | 'hid_medical_record_files'

type AccessRealtimeChange = {
  table: AccessRealtimeTable
}

type Listener = (change: AccessRealtimeChange) => void

const listeners = new Set<Listener>()
let activeChannel: ReturnType<typeof supabase.channel> | null = null

function notify(table: AccessRealtimeTable) {
  listeners.forEach(listener => {
    listener({ table })
  })
}

function ensureChannel() {
  if (activeChannel) return activeChannel

  activeChannel = supabase
    .channel('hid-access-shared')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'hid_access_requests',
      },
      () => {
        notify('hid_access_requests')
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'hid_access_grants',
      },
      () => {
        notify('hid_access_grants')
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'hid_audit_events',
      },
      () => {
        notify('hid_audit_events')
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'hid_medical_records',
      },
      () => {
        notify('hid_medical_records')
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'hid_medical_record_versions',
      },
      () => {
        notify('hid_medical_record_versions')
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'hid_medical_record_files',
      },
      () => {
        notify('hid_medical_record_files')
      }
    )
    .subscribe()

  return activeChannel
}

function teardownChannelIfIdle() {
  if (listeners.size > 0 || !activeChannel) return
  void supabase.removeChannel(activeChannel)
  activeChannel = null
}

export function subscribeToAccessChanges(onChange: Listener) {
  listeners.add(onChange)
  ensureChannel()

  return () => {
    listeners.delete(onChange)
    teardownChannelIfIdle()
  }
}
