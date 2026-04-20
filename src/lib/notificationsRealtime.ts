import { supabase } from './supabase'

function makeChannelName(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`
}

export function subscribeToNotifications(onChange: () => void) {
  let active = true

  const channel = supabase
    .channel(makeChannelName('hid-notifications'))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'hid_notifications',
      },
      () => {
        if (active) onChange()
      }
    )
    .subscribe()

  return () => {
    active = false
    void supabase.removeChannel(channel)
  }
}
