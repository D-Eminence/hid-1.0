import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { Card, Badge, Spinner, Button } from '../components/ui'
import { supabase, isConfigured } from '../lib/supabase'
import { timeAgo } from '../lib/utils'
import type { AccessLog, Patient } from '../types/database'

interface Stats {
  totalPatients: number
  totalRecords: number
  totalLogs: number
  recentLogs: AccessLog[]
  recentPatients: Patient[]
}

// Safe initials from a name string
function initials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

function NotConfigured() {
  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 24, marginBottom: 24 }}>
      <h3 style={{ fontWeight: 700, fontSize: 15, color: '#92400e', marginBottom: 8 }}>⚙️ Setup Required</h3>
      <ol style={{ fontSize: 13, color: '#78350f', lineHeight: 2.2, paddingLeft: 20, marginTop: 8 }}>
        <li>Go to <a href="https://supabase.com" target="_blank" rel="noreferrer" style={{ color: '#1a6fd4' }}>supabase.com</a> and create a free project</li>
        <li>Apply <code style={{ background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>supabase/schema.sql</code> or the files in <code style={{ background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>supabase/migrations/</code></li>
        <li>Copy your Project URL + anon key into <code style={{ background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>.env</code></li>
        <li>Restart the dev server</li>
      </ol>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats>({
    totalPatients: 0, totalRecords: 0, totalLogs: 0,
    recentLogs: [], recentPatients: []
  })
  const [loading, setLoading] = useState(isConfigured)
  const [dbError, setDbError] = useState<string | null>(null)

  useEffect(() => {
    if (!isConfigured) return
    async function load() {
      try {
        const [pCount, rCount, lCount, recentLogs, recentPatients] = await Promise.all([
          supabase.from('patients').select('id', { count: 'exact', head: true }),
          supabase.from('medical_records').select('id', { count: 'exact', head: true }),
          supabase.from('access_logs').select('id', { count: 'exact', head: true }),
          supabase.from('access_logs').select('*').order('access_time', { ascending: false }).limit(5),
          supabase.from('patients').select('*').order('created_at', { ascending: false }).limit(5),
        ])

        // Check for Supabase errors (e.g. tables don't exist yet)
        const firstError = [pCount, rCount, lCount, recentLogs, recentPatients].find(r => r.error)
        if (firstError?.error) {
          setDbError(firstError.error.message)
          setLoading(false)
          return
        }

        setStats({
          totalPatients: pCount.count ?? 0,
          totalRecords: rCount.count ?? 0,
          totalLogs: lCount.count ?? 0,
          recentLogs: recentLogs.data ?? [],
          recentPatients: recentPatients.data ?? [],
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setDbError(msg)
        console.error('Dashboard load error:', msg)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const statCards = [
    {
      label: 'Total Patients', value: stats.totalPatients,
      color: '#1a6fd4', bg: '#e8f1fc', action: () => navigate('/register'),
      icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M3 20c0-5 16-5 16 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
    },
    {
      label: 'Medical Records', value: stats.totalRecords,
      color: '#16a34a', bg: '#dcfce7', action: () => navigate('/records'),
      icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="2" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M7 8h8M7 12h6M7 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
    },
    {
      label: 'Access Logs', value: stats.totalLogs,
      color: '#d97706', bg: '#fef3c7', action: () => navigate('/logs'),
      icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 1a10 10 0 100 20A10 10 0 0011 1z" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M11 6v5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
    },
  ]

  return (
    <Layout title="Dashboard" subtitle="Health Identity Directory — Overview">
      {!isConfigured && <NotConfigured />}

      {dbError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '14px 18px', marginBottom: 20, fontSize: 13, color: '#991b1b' }}>
          <strong>Database error:</strong> {dbError}
          <br /><span style={{ color: '#b91c1c', marginTop: 4, display: 'block' }}>Make sure you have applied <code>supabase/schema.sql</code> or the files in <code>supabase/migrations/</code>.</span>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
          <Spinner size={32} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {statCards.map(s => (
              <Card key={s.label} onClick={s.action} style={{ cursor: 'pointer' }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: s.bg, color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  {s.icon}
                </div>
                <div style={{ fontSize: 32, fontWeight: 800, color: s.color, letterSpacing: '-1px', lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>{s.label}</div>
              </Card>
            ))}
          </div>

          {/* Quick actions */}
          <Card>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Quick Actions</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <Button onClick={() => navigate('/register')} fullWidth icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M2 14c0-3 12-3 12 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M12 2v6M9 5h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>}>Register New Patient</Button>
              <Button variant="secondary" onClick={() => navigate('/doctor')} fullWidth icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M5 5h6M5 8h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>}>Access Patient Records</Button>
              <Button variant="outline" onClick={() => navigate('/logs')} fullWidth icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 100 14A7 7 0 008 1z" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>}>View Access Logs</Button>
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Recent patients */}
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>Recent Patients</h3>
                <Button variant="ghost" size="sm" onClick={() => navigate('/register')}>View all</Button>
              </div>
              {stats.recentPatients.length === 0 ? (
                <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>
                  {isConfigured ? 'No patients registered yet' : 'Connect Supabase to see data'}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {stats.recentPatients.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e8f1fc', color: '#1a6fd4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                        {initials(p.full_name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name ?? '—'}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{p.hid_code ?? '—'}</div>
                      </div>
                      <Badge color="blue">{p.blood_group ?? '—'}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Recent logs */}
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>Recent Access</h3>
                <Button variant="ghost" size="sm" onClick={() => navigate('/logs')}>View all</Button>
              </div>
              {stats.recentLogs.length === 0 ? (
                <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>
                  {isConfigured ? 'No access logs yet' : 'Connect Supabase to see data'}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {stats.recentLogs.map(log => (
                    <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: log.access_type === 'emergency' ? '#dc2626' : '#1a6fd4' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.accessed_by ?? '—'}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{log.hid_code ?? '—'}</div>
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>{timeAgo(log.access_time)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </Layout>
  )
}
