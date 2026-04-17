import React, { useEffect, useState } from 'react'
import { Layout } from '../components/Layout'
import { Card, Input, Badge, EmptyState, Spinner, SectionHeader, Button, Modal } from '../components/ui'
import { supabase } from '../lib/supabase'
import { formatDateTime, timeAgo } from '../lib/utils'
import type { AccessLog } from '../types/database'

export default function AccessLogs() {
  const [logs, setLogs] = useState<AccessLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'standard' | 'emergency'>('all')
  const [selected, setSelected] = useState<AccessLog | null>(null)

  useEffect(() => { loadLogs() }, [])

  async function loadLogs() {
    setLoading(true)
    const { data } = await supabase
      .from('access_logs')
      .select('*')
      .order('access_time', { ascending: false })
    setLogs(data ?? [])
    setLoading(false)
  }

  const filtered = logs.filter(l => {
    const matchSearch =
      l.hid_code.toLowerCase().includes(search.toLowerCase()) ||
      l.accessed_by.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || l.access_type === filter
    return matchSearch && matchFilter
  })

  const emergencyCount = logs.filter(l => l.access_type === 'emergency').length

  return (
    <Layout title="Access Logs" subtitle="Complete audit trail of all record access events">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Stats bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {[
            { label: 'Total Access Events', value: logs.length, color: '#1a6fd4', bg: '#e8f1fc' },
            { label: 'Standard Access', value: logs.length - emergencyCount, color: '#16a34a', bg: '#dcfce7' },
            { label: 'Emergency Access', value: emergencyCount, color: '#dc2626', bg: '#fee2e2' },
          ].map(s => (
            <Card key={s.label} padding={18}>
              <div style={{ fontSize: 28, fontWeight: 800, color: s.color, letterSpacing: '-1px', lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{s.label}</div>
            </Card>
          ))}
        </div>

        {/* Filter bar */}
        <Card padding={14}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <Input
                placeholder="Search by HID code or doctor name..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                icon={<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3"/><path d="M10.5 10.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['all', 'standard', 'emergency'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: '8px 16px', borderRadius: 8, border: '1.5px solid',
                  borderColor: filter === f ? (f === 'emergency' ? '#dc2626' : '#1a6fd4') : '#e5e7eb',
                  background: filter === f ? (f === 'emergency' ? '#fee2e2' : f === 'standard' ? '#e8f1fc' : '#e8f1fc') : '#fff',
                  color: filter === f ? (f === 'emergency' ? '#dc2626' : '#1a6fd4') : '#6b7280',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s', textTransform: 'capitalize'
                }}>{f}</button>
              ))}
            </div>
            <Button variant="outline" onClick={loadLogs} size="sm">Refresh</Button>
          </div>
        </Card>

        {/* Logs table */}
        <Card padding={0}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
            <SectionHeader
              title={`Access Events (${filtered.length})`}
              subtitle="Immutable audit log - records cannot be edited or deleted"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: -8 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#16a34a', animation: 'pulse 2s infinite' }} />
              <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>Live - updates in real time</span>
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
              <Spinner size={28} />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<svg width="44" height="44" viewBox="0 0 44 44" fill="none"><path d="M22 4a18 18 0 100 36A18 18 0 0022 4z" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M22 13v9l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>}
              title="No access logs found"
              description="Access events are logged automatically when doctors retrieve patient records."
            />
          ) : (
            <div>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr 80px', gap: 12, padding: '10px 20px', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: '1px solid #f3f4f6' }}>
                <span>Patient HID</span><span>Accessed By</span><span>Type</span><span>Time</span><span>Details</span>
              </div>
              {filtered.map((log, i) => (
                <div key={log.id} style={{
                  display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr 80px', gap: 12,
                  padding: '13px 20px', borderBottom: i < filtered.length - 1 ? '1px solid #f9fafb' : 'none',
                  alignItems: 'center',
                  background: log.access_type === 'emergency' ? '#fffbeb' : 'transparent'
                }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#1a6fd4', fontWeight: 500 }}>{log.hid_code}</span>
                  <span style={{ fontSize: 13 }}>{log.accessed_by}</span>
                  <Badge color={log.access_type === 'emergency' ? 'red' : 'blue'}>
                    {log.access_type === 'emergency' ? '🚨 Emergency' : 'Standard'}
                  </Badge>
                  <div>
                    <div style={{ fontSize: 12, color: '#374151' }}>{timeAgo(log.access_time)}</div>
                    <div style={{ fontSize: 11, color: '#d1d5db' }}>{formatDateTime(log.access_time)}</div>
                  </div>
                  <button onClick={() => setSelected(log)} style={{
                    background: 'none', border: '1px solid #e5e7eb', borderRadius: 6,
                    padding: '5px 10px', fontSize: 12, color: '#6b7280', cursor: 'pointer'
                  }}>View</button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Log detail modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Access Log Details">
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Badge color={selected.access_type === 'emergency' ? 'red' : 'blue'}>
                {selected.access_type === 'emergency' ? '🚨 Emergency Access' : '✓ Standard Access'}
              </Badge>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, background: '#f9fafb', borderRadius: 10, padding: 16 }}>
              {[
                { label: 'Patient HID', value: selected.hid_code, mono: true },
                { label: 'Accessed By', value: selected.accessed_by },
                { label: 'Access Time', value: formatDateTime(selected.access_time) },
                { label: 'Access Type', value: selected.access_type },
              ].map(r => (
                <div key={r.label}>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{r.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 500, fontFamily: r.mono ? 'monospace' : undefined, color: r.mono ? '#1a6fd4' : undefined, textTransform: r.label === 'Access Type' ? 'capitalize' : undefined }}>{r.value}</div>
                </div>
              ))}
            </div>
            {selected.reason && (
              <div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Reason</div>
                <div style={{ fontSize: 14, color: '#374151', background: '#fef3c7', borderRadius: 8, padding: '12px 14px', lineHeight: 1.6, border: '1px solid #fde68a' }}>
                  {selected.reason}
                </div>
              </div>
            )}
            <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              Log ID: <span style={{ fontFamily: 'monospace' }}>{selected.id}</span>
            </p>
          </div>
        )}
      </Modal>
    </Layout>
  )
}
