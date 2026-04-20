import React, { useEffect } from 'react'
import { showToast } from './ui'
import { supabase } from '../lib/supabase'
import { subscribeToNotifications } from '../lib/notificationsRealtime'

type RawNotification = {
  id: string
  title: string
  message: string
  read_at: string | null
}

export function StaffNotificationWatcher({ onAccessRevoked }: { onAccessRevoked?: () => void }) {
  useEffect(() => {
    let cancelled = false

    async function flushUnreadSummary() {
      const { data, error } = await (supabase as unknown as { from: (name: string) => any }).from('hid_notifications')
        .select('id,title,message,read_at')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(10)

      if (cancelled || error) return

      const unread = ((data as RawNotification[] | null) ?? [])
      if (unread.length === 0) return

      let revokedHandled = false
      unread
        .slice()
        .reverse()
        .forEach(item => {
          const combined = `${item.title} ${item.message}`.toLowerCase()
          const isRevoked = combined.includes('access revoked') || combined.includes('revoked')
          showToast(`${item.title}: ${item.message}`, isRevoked ? 'error' : 'info')
          if (isRevoked && !revokedHandled) {
            revokedHandled = true
            onAccessRevoked?.()
          }
        })

      await (supabase as unknown as { from: (name: string) => any }).from('hid_notifications')
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null)
    }

    void flushUnreadSummary()
    const unsubscribe = subscribeToNotifications(() => {
      if (document.visibilityState === 'visible') {
        void flushUnreadSummary()
      }
    })
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void flushUnreadSummary()
      }
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void flushUnreadSummary()
      }
    }, 15000)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.clearInterval(interval)
    }
  }, [onAccessRevoked])

  return null
}
