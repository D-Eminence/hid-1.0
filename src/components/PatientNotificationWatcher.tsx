import React, { useEffect } from 'react'
import { showToast } from './toast'
import { listUnreadNotifications, markAllNotificationsRead } from '../lib/hidApi'
import { subscribeToNotifications } from '../lib/notificationsRealtime'
import { requestBrowserNotificationPermission, showBrowserNotification } from '../lib/pwa'

const TOAST_PREVIEW_LIMIT = 3

export function PatientNotificationWatcher({ hidCode }: { hidCode: string }) {
  useEffect(() => {
    let cancelled = false

    async function flushUnreadSummary() {
      const unread = await listUnreadNotifications(hidCode, TOAST_PREVIEW_LIMIT + 1, { forceRefresh: true })
      if (cancelled || unread.length === 0) return

      if (unread.length <= TOAST_PREVIEW_LIMIT) {
        unread.slice().reverse().forEach(item => {
          showToast(`${item.title}: ${item.message}`, item.message.toLowerCase().includes('emergency') ? 'error' : 'info')
          void showBrowserNotification(item.title, {
            body: item.message,
            tag: `hid-notification-${item.id}`,
          })
        })
      } else {
        const emergencyItem = unread.find(item => `${item.title} ${item.message}`.toLowerCase().includes('emergency'))
        if (emergencyItem) {
          showToast(`${emergencyItem.title}: ${emergencyItem.message}`, 'error')
          void showBrowserNotification(emergencyItem.title, {
            body: emergencyItem.message,
            tag: `hid-notification-${emergencyItem.id}`,
          })
        }
        showToast(`You have ${unread.length} new notifications. Open Notifications to review them.`, 'info')
        void showBrowserNotification('New HID notifications', {
          body: `You have ${unread.length} new notifications.`,
          tag: 'hid-notifications-summary',
        })
      }

      await markAllNotificationsRead()
    }

    void requestBrowserNotificationPermission()
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
    }, 45000)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      cancelled = true
      unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.clearInterval(interval)
    }
  }, [hidCode])

  return null
}
