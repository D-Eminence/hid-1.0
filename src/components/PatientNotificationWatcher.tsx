import React, { useEffect } from 'react'
import { showToast } from './ui'
import { listUnreadNotifications, markAllNotificationsRead } from '../lib/hidApi'
import { subscribeToNotifications } from '../lib/notificationsRealtime'

const TOAST_PREVIEW_LIMIT = 3

export function PatientNotificationWatcher({ hidCode }: { hidCode: string }) {
  useEffect(() => {
    let cancelled = false

    async function flushUnreadSummary() {
      const unread = await listUnreadNotifications(hidCode, TOAST_PREVIEW_LIMIT + 1)
      if (cancelled || unread.length === 0) return

      if (unread.length <= TOAST_PREVIEW_LIMIT) {
        unread.slice().reverse().forEach(item => {
          showToast(`${item.title}: ${item.message}`, item.message.toLowerCase().includes('emergency') ? 'error' : 'info')
        })
      } else {
        const emergencyItem = unread.find(item => `${item.title} ${item.message}`.toLowerCase().includes('emergency'))
        if (emergencyItem) {
          showToast(`${emergencyItem.title}: ${emergencyItem.message}`, 'error')
        }
        showToast(`You have ${unread.length} new notifications. Open Notifications to review them.`, 'info')
      }

      await markAllNotificationsRead()
    }

    void flushUnreadSummary()
    const unsubscribe = subscribeToNotifications(() => {
      if (document.visibilityState === 'visible') {
        void flushUnreadSummary()
      }
    })
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void flushUnreadSummary()
      }
    }, 15000)
    return () => {
      cancelled = true
      unsubscribe()
      window.clearInterval(interval)
    }
  }, [hidCode])

  return null
}
