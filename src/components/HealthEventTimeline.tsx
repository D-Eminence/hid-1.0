import React, { useMemo, useState } from 'react'
import { Badge, Button, Card, EmptyState, Input, Modal, SectionHeader, showToast } from './ui'
import {
  getHealthEventCategoryLabel,
  getHealthEventStatusBadge,
  getRecordsForHealthEvent,
  formatHealthEventDateRange,
} from '../lib/healthEventUtils'
import { formatDateTime } from '../lib/utils'
import { formatHealthInfoType } from '../lib/medicalRecordUtils'
import type { MedicalRecord } from '../types/database'
import type { HidHealthEvent, HidHealthEventStatus } from '../types/hid'

interface HealthEventTimelineProps {
  events: HidHealthEvent[]
  records: MedicalRecord[]
  onCreateEvent: () => void
  onAddRecord: (eventId: string, recordId: string) => Promise<void>
  onRemoveRecord: (eventId: string, recordId: string) => Promise<void>
  onRename: (eventId: string, title: string) => Promise<void>
  onToggleStatus: (eventId: string, status: HidHealthEventStatus) => Promise<void>
}

export function HealthEventTimeline({
  events,
  records,
  onCreateEvent,
  onAddRecord,
  onRemoveRecord,
  onRename,
  onToggleStatus,
}: HealthEventTimelineProps) {
  const [addRecordEventId, setAddRecordEventId] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  async function runAction(key: string, action: () => Promise<void>) {
    if (busyKey) return
    setBusyKey(key)
    try {
      await action()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.'
      showToast(message, 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const addRecordEvent = events.find(event => event.id === addRecordEventId) ?? null
  const availableForAdd = useMemo(() => {
    if (!addRecordEvent) return []
    const used = new Set(addRecordEvent.record_ids)
    return records.filter(record => !used.has(record.id))
  }, [addRecordEvent, records])

  return (
    <Card style={{ borderRadius: 24, marginBottom: 18 }}>
      <SectionHeader
        title="Health events"
        subtitle="Group related records into an episode, like a hospital visit or an ongoing condition."
        action={<Button onClick={onCreateEvent}>New health event</Button>}
      />

      {events.length === 0 ? (
        <EmptyState
          icon={<span style={{ fontSize: 28 }}>[]</span>}
          title="No health events yet"
          description="Create a health event to group related records together, like a hospital visit or an illness."
          action={<Button onClick={onCreateEvent}>New health event</Button>}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {events.map(event => (
            <HealthEventCard
              key={event.id}
              event={event}
              records={getRecordsForHealthEvent(event, records)}
              busy={busyKey?.startsWith(event.id) ?? false}
              onAddRecord={() => setAddRecordEventId(event.id)}
              onRemoveRecord={recordId => void runAction(`${event.id}:remove:${recordId}`, () => onRemoveRecord(event.id, recordId))}
              onRename={title => runAction(`${event.id}:rename`, () => onRename(event.id, title))}
              onToggleStatus={() => runAction(`${event.id}:status`, () => onToggleStatus(event.id, event.status === 'closed' ? 'open' : 'closed'))}
            />
          ))}
        </div>
      )}

      <Modal open={Boolean(addRecordEvent)} onClose={() => setAddRecordEventId(null)} title="Add a record to this event" width={520}>
        {availableForAdd.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 13 }}>All of your records are already part of this health event.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {availableForAdd.map(record => (
              <button
                key={record.id}
                type="button"
                disabled={Boolean(busyKey)}
                onClick={() => {
                  if (!addRecordEvent) return
                  void runAction(`${addRecordEvent.id}:add:${record.id}`, () => onAddRecord(addRecordEvent.id, record.id))
                }}
                style={{
                  textAlign: 'left',
                  borderRadius: 12,
                  border: '1px solid #edf1f5',
                  background: '#fff',
                  padding: '10px 14px',
                  cursor: busyKey ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{record.title}</span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>{formatHealthInfoType(record.info_type, record.category)} · {formatDateTime(record.created_at)}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </Card>
  )
}

function HealthEventCard({
  event,
  records,
  busy,
  onAddRecord,
  onRemoveRecord,
  onRename,
  onToggleStatus,
}: {
  event: HidHealthEvent
  records: MedicalRecord[]
  busy: boolean
  onAddRecord: () => void
  onRemoveRecord: (recordId: string) => void
  onRename: (title: string) => Promise<void>
  onToggleStatus: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(event.title)
  const statusBadge = getHealthEventStatusBadge(event.status)

  async function saveRename() {
    const trimmed = title.trim()
    if (!trimmed || trimmed === event.title) {
      setTitle(event.title)
      setRenaming(false)
      return
    }
    await onRename(trimmed)
    setRenaming(false)
  }

  return (
    <div style={{ border: '1px solid #edf1f5', borderRadius: 18, padding: 16, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          {renaming ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input value={title} onChange={e => setTitle(e.target.value)} style={{ height: 36 }} />
              <Button size="sm" disabled={busy} onClick={() => void saveRename()}>Save</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setTitle(event.title); setRenaming(false) }}>Cancel</Button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: '#111827' }}>{event.title}</span>
              <Badge color={statusBadge.color}>{statusBadge.label}</Badge>
              <Badge color="gray">{getHealthEventCategoryLabel(event.info_category)}</Badge>
              <button type="button" onClick={() => setRenaming(true)} style={{ border: 'none', background: 'none', color: '#1a6fd4', fontWeight: 600, cursor: 'pointer', fontSize: 12, padding: 0 }}>
                Rename
              </button>
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>{formatHealthEventDateRange(event)}</div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="secondary" disabled={busy} onClick={onAddRecord}>+ Add record</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={onToggleStatus}>
            {event.status === 'closed' ? 'Reopen' : 'Close event'}
          </Button>
        </div>
      </div>

      {records.length === 0 ? (
        <p style={{ marginTop: 12, fontSize: 13, color: '#9ca3af' }}>No records added to this event yet.</p>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {records.map(record => (
            <div key={record.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, border: '1px solid #f3f4f6', borderRadius: 12, padding: '8px 12px' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{record.title}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{formatHealthInfoType(record.info_type, record.category)} · {formatDateTime(record.created_at)}</div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemoveRecord(record.id)}
                style={{ border: 'none', background: 'none', color: '#dc2626', cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 12 }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
