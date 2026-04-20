import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PortalShell } from '../../components/PortalShell'
import { Button, Card, PageLoader, showToast } from '../../components/ui'
import { getPatientSession, signOutAndClearSessions } from '../../lib/auth'
import { fetchMyPatient, listNotifications, markNotificationRead } from '../../lib/hidApi'
import { subscribeToNotifications } from '../../lib/notificationsRealtime'
import { formatDateTime } from '../../lib/utils'
import type { Notification, Patient } from '../../types/database'

const patientNav = [
  { path: '/patient/profile', label: 'Profile' },
  { path: '/patient/records', label: 'Records' },
  { path: '/patient/history', label: 'Access History' },
  { path: '/patient/notifications', label: 'Notifications' },
]

export default function PatientNotifications() {
  const navigate = useNavigate()
  const session = useMemo(() => getPatientSession(), [])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [patient, setPatient] = useState<Patient | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session) {
      navigate('/patient')
      return
    }
    void loadNotificationsPage()
  }, [navigate, session])

  useEffect(() => {
    if (!session) return
    const unsubscribe = subscribeToNotifications(() => {
      void loadNotificationsPage()
    })

    return () => {
      unsubscribe()
    }
  }, [session])

  async function loadNotificationsPage() {
    if (!session) return
    setLoading(true)
    try {
      const [nextPatient, nextNotifications] = await Promise.all([
        fetchMyPatient(),
        listNotifications(session.hidCode),
      ])
      setPatient(nextPatient)
      setNotifications(nextNotifications)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load notifications.'
      showToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function logout() {
    await signOutAndClearSessions()
    navigate('/patient')
  }

  async function markRead(id: string) {
    try {
      await markNotificationRead(id)
      setNotifications(items => items.map(item => item.id === id ? { ...item, is_read: true } : item))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update this notification.'
      showToast(message, 'error')
    }
  }

  if (!session) return null
  if (loading) {
    return (
      <PortalShell
        title="Notifications"
        subtitle="Access alerts and system updates"
        items={patientNav}
        onLogout={() => { void logout() }}
        userName={patient?.full_name ?? session.fullName}
        avatarUrl={patient?.photo_url}
        notificationPath="/patient/notifications"
      >
        <PageLoader label="Loading your notifications..." />
      </PortalShell>
    )
  }

  return (
    <PortalShell
      title="Notifications"
      subtitle="Access alerts and system updates"
      items={patientNav}
      onLogout={() => { void logout() }}
      userName={patient?.full_name ?? session.fullName}
      avatarUrl={patient?.photo_url}
      notificationPath="/patient/notifications"
    >
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {notifications.map(item => (
            <div key={item.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, background: item.is_read ? '#fff' : '#eff6ff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{item.title}</div>
                  <div style={{ color: '#374151', marginTop: 6 }}>{item.message}</div>
                  <div style={{ color: '#6b7280', fontSize: 13, marginTop: 6 }}>{formatDateTime(item.created_at)}</div>
                </div>
                {!item.is_read && <Button size="sm" variant="outline" onClick={() => void markRead(item.id)}>Mark read</Button>}
              </div>
            </div>
          ))}
          {notifications.length === 0 && <div style={{ color: '#6b7280' }}>No notifications yet.</div>}
        </div>
      </Card>
    </PortalShell>
  )
}
