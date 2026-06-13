import React, { useState } from 'react'
import { Button, Input, Modal, Select, showToast } from './ui'
import { HEALTH_EVENT_CATEGORIES } from '../lib/healthEventUtils'
import { formatDateTime } from '../lib/utils'
import { formatHealthInfoType } from '../lib/medicalRecordUtils'
import type { MedicalRecord } from '../types/database'

interface CreateHealthEventModalProps {
  open: boolean
  onClose: () => void
  records: MedicalRecord[]
  onSubmit: (data: { title: string; infoCategory: string; recordIds: string[] }) => Promise<void>
}

export function CreateHealthEventModal({ open, onClose, records, onSubmit }: CreateHealthEventModalProps) {
  const [title, setTitle] = useState('')
  const [infoCategory, setInfoCategory] = useState('general')
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  function reset() {
    setTitle('')
    setInfoCategory('general')
    setSelectedRecordIds([])
  }

  function handleClose() {
    if (saving) return
    reset()
    onClose()
  }

  function toggleRecord(recordId: string) {
    setSelectedRecordIds(current => current.includes(recordId)
      ? current.filter(id => id !== recordId)
      : [...current, recordId])
  }

  async function handleSubmit() {
    if (saving) return
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      showToast('Enter a name for this health event.', 'error')
      return
    }

    setSaving(true)
    try {
      await onSubmit({ title: trimmedTitle, infoCategory, recordIds: selectedRecordIds })
      reset()
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create health event.'
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="New health event" width={560}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Input
          label="Event name"
          placeholder="e.g. Flu - March 2026"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <Select
          label="Category"
          value={infoCategory}
          onChange={e => setInfoCategory(e.target.value)}
          options={HEALTH_EVENT_CATEGORIES}
        />

        {records.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
              Add existing records (optional)
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
              {records.map(record => (
                <label
                  key={record.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    border: '1px solid #edf1f5',
                    borderRadius: 12,
                    padding: '10px 14px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedRecordIds.includes(record.id)}
                    onChange={() => toggleRecord(record.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{record.title}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{formatHealthInfoType(record.info_type, record.category)} · {formatDateTime(record.created_at)}</div>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
          <Button variant="secondary" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button loading={saving} onClick={() => void handleSubmit()}>Create event</Button>
        </div>
      </div>
    </Modal>
  )
}
