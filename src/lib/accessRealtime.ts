import { supabase } from './supabase'

type Listener = () => void

const listeners = new Set<Listener>()
let activeChannel: ReturnType<typeof supabase.channel> | null = null

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
        listeners.forEach(listener => {
          listener()
        })
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
        listeners.forEach(listener => {
          listener()
        })
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
        listeners.forEach(listener => {
          listener()
        })
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
