import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PortalShell } from '../../components/PortalShell'
import { Badge, Button, Card, PageLoader, showToast } from '../../components/ui'
import { getPatientSession, signOutAndClearSessions } from '../../lib/auth'
import {
  fetchMyPatient,
  fetchPatientHistory,
  revokeAccessGrant,
} from '../../lib/hidApi'
import { formatDateTime, getAccessLogLabel } from '../../lib/utils'
import type { AccessLog, AccessRequest, Patient } from '../../types/database'

const patientNav = [
  { path: '/patient/profile', label: 'Home' },
  { path: '/patient/records', label: 'Records' },
  { path: '/patient/history', label: 'Access History' },
  { path: '/patient/notifications', label: 'Notifications' },
]

function timeAgo(input: string) {
  const diffMs = Date.now() - new Date(input).getTime()
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000))
  if (diffMinutes < 60) return `${diffMinutes} mins ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} hrs ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} days ago`
}

function getRequestDuration(request: AccessRequest) {
  if (request.duration_hours && request.duration_hours > 0) {
    return `Up to ${request.duration_hours} hour${request.duration_hours === 1 ? '' : 's'}`
  }
  return 'Until you respond'
}

function getAccessLabel(request: AccessRequest) {
  return request.request_type === 'emergency' ? 'Emergency Access' : 'Standard Access'
}

export default function PatientHistory() {
  const navigate = useNavigate()
  const session = useMemo(() => getPatientSession(), [])
  const [logs, setLogs] = useState<AccessLog[]>([])
  const [patient, setPatient] = useState<Patient | null>(null)
  const [activeGrants, setActiveGrants] = useState<AccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState('')

  useEffect(() => {
    if (!session) {
      navigate('/patient')
      return
    }
    void loadHistoryData()
  }, [navigate, session])

  async function loadHistoryData(silent = false) {
    if (!session) return
    if (!silent) setLoading(true)
    try {
      const [nextPatient, history] = await Promise.all([
        fetchMyPatient(),
        fetchPatientHistory(session.hidCode),
      ])
      setPatient(nextPatient)
      setActiveGrants(history.activeGrants)
      setLogs(history.logs)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load your access history.'
      showToast(message, 'error')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function logout() {
    await signOutAndClearSessions()
    navigate('/patient')
  }

  async function revokeGrant(grant: AccessRequest) {
    setActingId(grant.id)
    try {
      await revokeAccessGrant(grant.id)
      setActiveGrants(current => current.filter(item => item.id !== grant.id))
      showToast('Access revoked.', 'success')
      void loadHistoryData(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to revoke access.'
      showToast(message, 'error')
    } finally {
      setActingId('')
    }
  }

  if (!session) return null
  if (loading) {
    return (
      <PortalShell
        title="Access history"
        subtitle="Review active access and see your access logs."
        items={patientNav}
        onLogout={() => { void logout() }}
        userName={patient?.full_name ?? session.fullName}
        avatarUrl={patient?.photo_url}
        notificationPath="/patient/notifications"
        notificationHidCode={session.hidCode}
      >
        <PageLoader label="Loading your access history..." />
      </PortalShell>
    )
  }

  return (
    <PortalShell
      title="Access history"
      subtitle="Review active access and see your access logs."
      items={patientNav}
      onLogout={() => { void logout() }}
      userName={patient?.full_name ?? session.fullName}
      avatarUrl={patient?.photo_url}
      notificationPath="/patient/notifications"
      notificationHidCode={session.hidCode}
    >
      <Card style={{ borderRadius: 24, marginBottom: 18 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Active access</div>
        <div style={{ color: '#8a95a6', marginTop: 6, fontSize: 13 }}>Providers that currently have access to your records.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(248px, 1fr))', gap: 18, marginTop: 24 }}>
          {activeGrants.map(request => {
            const isEmergency = request.request_type === 'emergency'
            const accent = isEmergency ? '#ff2d35' : '#1877e6'
            return (
              <div
                key={request.id}
                style={{
                  borderRadius: 20,
                  background: '#fff',
                  border: '1px solid #edf1f5',
                  borderTop: `5px solid ${accent}`,
                  borderBottom: `5px solid ${accent}`,
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '16px 16px 12px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      height: 24,
                      padding: '0 10px',
                      borderRadius: 999,
                      background: isEmergency ? '#fff1f2' : '#eef6ff',
                      color: isEmergency ? '#dc2626' : '#1877e6',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {getAccessLabel(request)}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, paddingBottom: 12, borderBottom: '1px solid #f1f5f9' }}>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 10,
                        border: '1px solid #edf1f5',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6b7280',
                        background: '#fff',
                        flexShrink: 0,
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M3 2.7h10v10.6H3V2.7Z" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M5.2 13.3V9.5h5.6v3.8M5 5.5h6M5 7.5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </span>
                    <div style={{ fontSize: 18, fontWeight: 500, color: '#334155', lineHeight: 1.25 }}>{request.doctor_name}</div>
                  </div>
                </div>

                <div style={{ padding: '0 16px 16px' }}>
                  <div style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontWeight: 700, color: '#111827' }}>Access:</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#334155', lineHeight: 1.55 }}>
                      <div>Medical Records</div>
                      <div>Lab Results</div>
                      <div>Medications</div>
                    </div>
                  </div>

                  <div style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontWeight: 700, color: '#111827' }}>Used by:</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#334155', lineHeight: 1.55 }}>
                      <div>1 Provider</div>
                      <div>{isEmergency ? 'Emergency session' : 'Approved provider session'}</div>
                    </div>
                  </div>

                  <div style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontWeight: 700, color: '#111827' }}>Duration:</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#334155', lineHeight: 1.55 }}>
                      <div>{request.access_expires_at ? `${formatDateTime(request.approved_at ?? request.created_at)} - ${formatDateTime(request.access_expires_at)}` : getRequestDuration(request)}</div>
                    </div>
                  </div>

                  <div style={{ padding: '12px 0 10px' }}>
                    <div style={{ fontWeight: 700, color: '#111827' }}>Last Activity</div>
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12, color: '#334155' }}>
                      <span>{request.reason || 'Access currently active'}</span>
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{timeAgo(request.approved_at ?? request.created_at)}</span>
                    </div>
                  </div>

                  <Button size="sm" variant="danger" loading={actingId === request.id} onClick={() => void revokeGrant(request)} style={{ marginTop: 8 }}>
                    Revoke access
                  </Button>
                </div>
              </div>
            )
          })}
          {activeGrants.length === 0 && <div style={{ color: '#6b7280' }}>No active provider access right now.</div>}
        </div>
      </Card>

      <Card style={{ borderRadius: 24 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Access Logs</div>
        <div style={{ color: '#8a95a6', marginTop: 6, fontSize: 13 }}>Security-relevant activity related to your record access.</div>
        <div style={{ overflowX: 'auto', marginTop: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                <th style={{ padding: '12px 10px' }}>Actor</th>
                <th style={{ padding: '12px 10px' }}>Activity</th>
                <th style={{ padding: '12px 10px' }}>Reason</th>
                <th style={{ padding: '12px 10px' }}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{ borderTop: '1px solid #edf1f5' }}>
                  <td style={{ padding: '12px 10px', fontWeight: 600 }}>{log.accessed_by}</td>
                  <td style={{ padding: '12px 10px' }}>{getAccessLogLabel(log)}</td>
                  <td style={{ padding: '12px 10px' }}>{log.reason || '-'}</td>
                  <td style={{ padding: '12px 10px' }}>{formatDateTime(log.access_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <div style={{ color: '#6b7280', marginTop: 12 }}>No access history yet.</div>}
        </div>
      </Card>
    </PortalShell>
  )
}
