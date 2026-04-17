import React, { useEffect, useState } from 'react'
import { Layout } from '../components/Layout'
import { Card, Input, Button, Badge, EmptyState, Spinner, SectionHeader, Modal, Textarea, showToast } from '../components/ui'
import { supabase } from '../lib/supabase'
import { formatDateTime, timeAgo } from '../lib/utils'
import type { MedicalRecord } from '../types/database'

export default function MedicalRecords() {
  const [records, setRecords] = useState<MedicalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<MedicalRecord | null>(null)

  useEffect(() => { loadRecords() }, [])

  async function loadRecords() {
    setLoading(true)
    const { data } = await supabase
      .from('medical_records')
      .select('*')
      .order('created_at', { ascending: false })
    setRecords(data ?? [])
    setLoading(false)
  }

  async function deleteRecord(id: string) {
    if (!confirm('Delete this record permanently?')) return
    const { error } = await supabase.from('medical_records').delete().eq('id', id)
    if (error) { showToast(error.message, 'error'); return }
    setRecords(r => r.filter(rec => rec.id !== id))
    setSelected(null)
    showToast('Record deleted', 'info')
  }

  const filtered = records.filter(r =>
    r.title.toLowerCase().includes(search.toLowerCase()) ||
    r.hid_code.toLowerCase().includes(search.toLowerCase()) ||
    r.created_by.toLowerCase().includes(search.toLowerCase()) ||
    r.record.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Layout title="Medical Records" subtitle="Browse and manage all patient medical records">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Card padding={16}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <Input
                placeholder="Search by HID, title, doctor name..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                icon={<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3"/><path d="M10.5 10.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>}
              />
            </div>
            <Button variant="outline" onClick={loadRecords} size="sm" icon={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 7A5 5 0 112 7a5 5 0 002 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M4 11l-2 0 0-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }>Refresh</Button>
          </div>
        </Card>

        <Card padding={0}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionHeader
              title={`Medical Records (${filtered.length})`}
              subtitle="All patient records sorted by newest first"
            />
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
              <Spinner size={28} />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<svg width="44" height="44" viewBox="0 0 44 44" fill="none"><rect x="7" y="5" width="30" height="34" rx="4" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M15 15h14M15 21h10M15 27h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>}
              title={search ? 'No records match your search' : 'No medical records yet'}
              description="Records are created when doctors access patient profiles and add notes."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 80px', gap: 12, padding: '10px 20px', borderBottom: '1px solid #f3f4f6', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                <span>Title</span><span>Patient HID</span><span>Added By</span><span>Date</span><span></span>
              </div>
              {filtered.map((rec, i) => (
                <div key={rec.id} style={{
                  display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 80px', gap: 12,
                  padding: '14px 20px', borderBottom: i < filtered.length - 1 ? '1px solid #f9fafb' : 'none',
                  alignItems: 'center', cursor: 'pointer', transition: 'background 0.1s'
                }}
                  onClick={() => setSelected(rec)}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{rec.title}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{rec.record}</div>
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#1a6fd4' }}>{rec.hid_code}</span>
                  <span style={{ fontSize: 13, color: '#374151' }}>{rec.created_by}</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>{timeAgo(rec.created_at)}</span>
                  <button onClick={e => { e.stopPropagation(); deleteRecord(rec.id) }} style={{ background: 'none', border: 'none', color: '#d1d5db', padding: 4, borderRadius: 6, cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#d1d5db')}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V3h6v1M6 7v5M10 7v5M3 4l1 9h8l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Record detail modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Medical Record Details" width={540}>
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, background: '#f9fafb', borderRadius: 10, padding: 16 }}>
              {[
                { label: 'Patient HID', value: selected.hid_code, mono: true },
                { label: 'Added by', value: selected.created_by },
                { label: 'Date & Time', value: formatDateTime(selected.created_at) },
              ].map(r => (
                <div key={r.label}>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>{r.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 500, fontFamily: r.mono ? 'monospace' : undefined, color: r.mono ? '#1a6fd4' : undefined }}>{r.value}</div>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>TITLE</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{selected.title}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>RECORD CONTENT</div>
              <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, background: '#f9fafb', borderRadius: 8, padding: 14 }}>{selected.record}</div>
            </div>
            <Button variant="danger" onClick={() => deleteRecord(selected.id)} icon={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3.5h10M4.5 3.5V2.5h5v1M5 6v4.5M9 6v4.5M2.5 3.5l.5 8h8l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }>Delete Record</Button>
          </div>
        )}
      </Modal>
    </Layout>
  )
}
