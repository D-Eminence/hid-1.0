import React, { useState } from 'react'
import { badgeMap, Button, Input, Modal, Select, Textarea, showToast } from './ui'
import { FileAttachmentPreview } from './RecordMarkdownView'
import { VoiceToTextButton } from './VoiceToTextButton'
import {
  HEALTH_INFO_TYPES,
  RECORD_UPLOAD_ACCEPT,
  buildHealthInfoTitle,
  createEmptyHealthInfoValues,
  type HealthInfoField,
  type HealthInfoTypeConfig,
  type HealthInfoValues,
  type UploadDraft,
} from '../lib/medicalRecordUtils'
import { HEALTH_EVENT_CATEGORIES, getHealthEventStatusBadge } from '../lib/healthEventUtils'
import type { HidHealthEvent } from '../types/hid'

export type HealthEventOrganizeChoice =
  | { mode: 'none' }
  | { mode: 'new'; title: string; infoCategory: string }
  | { mode: 'existing'; eventId: string }

export interface HealthInformationSubmission {
  infoType: string
  title: string
  structuredData: Record<string, unknown>
  notes: string
  transcriptionText: string
  uploads: UploadDraft[]
  healthEvent: HealthEventOrganizeChoice
}

interface AddHealthInformationModalProps {
  open: boolean
  onClose: () => void
  saving: boolean
  preparingUploads: boolean
  uploads: UploadDraft[]
  healthEvents: HidHealthEvent[]
  onAttachment: (files: FileList | null) => void | Promise<void>
  onRemoveUpload: (index: number) => void
  onSubmit: (submission: HealthInformationSubmission) => void | Promise<void>
}

export function AddHealthInformationModal({
  open,
  onClose,
  saving,
  preparingUploads,
  uploads,
  healthEvents,
  onAttachment,
  onRemoveUpload,
  onSubmit,
}: AddHealthInformationModalProps) {
  const [selectedType, setSelectedType] = useState<HealthInfoTypeConfig | null>(null)
  const [values, setValues] = useState<HealthInfoValues>({})
  const [notes, setNotes] = useState('')
  const [transcriptionText, setTranscriptionText] = useState('')
  const [organizeMode, setOrganizeMode] = useState<HealthEventOrganizeChoice['mode']>('none')
  const [newEventTitle, setNewEventTitle] = useState('')
  const [newEventCategory, setNewEventCategory] = useState('general')
  const [existingEventId, setExistingEventId] = useState('')

  function reset() {
    setSelectedType(null)
    setValues({})
    setNotes('')
    setTranscriptionText('')
    setOrganizeMode('none')
    setNewEventTitle('')
    setNewEventCategory('general')
    setExistingEventId('')
  }

  function handleClose() {
    reset()
    onClose()
  }

  function selectType(type: HealthInfoTypeConfig) {
    setSelectedType(type)
    setValues(createEmptyHealthInfoValues(type.id))
  }

  function setFieldValue(key: string, value: string) {
    setValues(current => ({ ...current, [key]: value }))
  }

  function appendTranscript(transcript: string) {
    setTranscriptionText(current => `${current}${current.trim() ? '\n' : ''}${transcript}`.trim())
  }

  async function handleSubmit() {
    if (!selectedType || saving || preparingUploads) return

    const missingField = selectedType.fields.find(field => field.required && !(values[field.key] ?? '').trim())
    if (missingField) {
      showToast(`Enter ${missingField.label.toLowerCase()} before saving.`, 'error')
      return
    }
    if (selectedType.requiresAttachment && uploads.length === 0) {
      showToast('Attach a file before saving.', 'error')
      return
    }

    let healthEvent: HealthEventOrganizeChoice = { mode: 'none' }
    if (organizeMode === 'new') {
      const trimmedEventTitle = newEventTitle.trim()
      if (!trimmedEventTitle) {
        showToast('Enter a name for the new health event.', 'error')
        return
      }
      healthEvent = { mode: 'new', title: trimmedEventTitle, infoCategory: newEventCategory }
    } else if (organizeMode === 'existing') {
      if (!existingEventId) {
        showToast('Choose a health event to add this to.', 'error')
        return
      }
      healthEvent = { mode: 'existing', eventId: existingEventId }
    }

    const structuredData: Record<string, unknown> = {}
    selectedType.fields.forEach(field => {
      const value = (values[field.key] ?? '').trim()
      if (value) structuredData[field.key] = value
    })

    const title = buildHealthInfoTitle(selectedType.id, values, uploads[0]?.file_name)

    await onSubmit({
      infoType: selectedType.id,
      title,
      structuredData,
      notes,
      transcriptionText,
      uploads,
      healthEvent,
    })
    reset()
  }

  const modalTitle = selectedType ? selectedType.label : 'Add health information'

  return (
    <Modal open={open} onClose={handleClose} title={modalTitle} width={780}>
      {!selectedType ? (
        <div>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: -4, marginBottom: 14 }}>
            Choose the type of health information you want to add to your record.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {HEALTH_INFO_TYPES.map(type => {
              const colors = badgeMap[type.accent]
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => selectType(type)}
                  style={{
                    textAlign: 'left',
                    borderRadius: 14,
                    border: '1px solid #edf1f5',
                    background: '#fff',
                    padding: '12px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: colors.bg,
                      color: colors.text,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 14,
                      flexShrink: 0,
                    }}
                  >
                    {type.label.charAt(0)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{type.label}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{type.description}</div>
                  </span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: '#c7ccd4' }} aria-hidden="true">
                    <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <button
            type="button"
            onClick={() => { setSelectedType(null); setValues({}) }}
            style={{ border: 'none', background: 'none', color: '#1a6fd4', fontWeight: 600, cursor: 'pointer', padding: 0, justifySelf: 'flex-start', fontSize: 13 }}
          >
            &lt; Choose a different type
          </button>

          {selectedType.fields.map(field => renderField(field, values, setFieldValue))}

          <Textarea label="Notes" value={notes} onChange={event => setNotes(event.target.value)} />
          <VoiceToTextButton onTranscript={appendTranscript} label="Add note by voice" />
          {transcriptionText && (
            <Textarea label="Voice note transcript" value={transcriptionText} onChange={event => setTranscriptionText(event.target.value)} />
          )}

          {(selectedType.supportsAttachments || selectedType.requiresAttachment) && (
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
                {selectedType.requiresAttachment ? 'Attach file *' : 'Attach file (optional)'}
              </label>
              <input type="file" multiple accept={RECORD_UPLOAD_ACCEPT} disabled={preparingUploads || saving} onChange={event => void onAttachment(event.target.files)} />
            </div>
          )}

          {uploads.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              {uploads.map((file, index) => (
                <div key={`${file.file_name}-${index}`} style={{ display: 'grid', gap: 8 }}>
                  <FileAttachmentPreview attachment={file} />
                  <button type="button" onClick={() => onRemoveUpload(index)} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 600, justifySelf: 'flex-end' }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Add to a health event (optional)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <OrganizeOption active={organizeMode === 'none'} onClick={() => setOrganizeMode('none')}>
                Don&apos;t add to a health event
              </OrganizeOption>
              <OrganizeOption active={organizeMode === 'new'} onClick={() => setOrganizeMode('new')}>
                Create a new health event
              </OrganizeOption>
              {healthEvents.length > 0 && (
                <OrganizeOption active={organizeMode === 'existing'} onClick={() => setOrganizeMode('existing')}>
                  Add to an existing health event
                </OrganizeOption>
              )}
            </div>

            {organizeMode === 'new' && (
              <div style={{ display: 'grid', gap: 10 }}>
                <Input
                  placeholder="e.g. Typhoid Treatment"
                  value={newEventTitle}
                  onChange={e => setNewEventTitle(e.target.value)}
                />
                <Select
                  value={newEventCategory}
                  onChange={e => setNewEventCategory(e.target.value)}
                  options={HEALTH_EVENT_CATEGORIES}
                />
              </div>
            )}

            {organizeMode === 'existing' && (
              <Select
                value={existingEventId}
                onChange={e => setExistingEventId(e.target.value)}
                options={healthEvents
                  .filter(event => event.status !== 'archived')
                  .map(event => ({ value: event.id, label: `${event.title} (${getHealthEventStatusBadge(event.status).label})` }))}
              />
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
            <Button variant="secondary" onClick={handleClose}>Cancel</Button>
            <Button loading={saving || preparingUploads} disabled={preparingUploads} onClick={() => void handleSubmit()}>
              {preparingUploads ? 'Preparing files...' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function OrganizeOption({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? '#1891ff' : '#e5e7eb'}`,
        borderRadius: 999,
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        background: active ? '#e8f1fc' : '#fff',
        color: active ? '#1891ff' : '#484f58',
      }}
    >
      {children}
    </button>
  )
}

function renderField(field: HealthInfoField, values: HealthInfoValues, onChange: (key: string, value: string) => void) {
  const label = field.required ? `${field.label} *` : field.label

  if (field.kind === 'select') {
    return (
      <Select
        key={field.key}
        label={label}
        value={values[field.key] ?? ''}
        onChange={event => onChange(field.key, event.target.value)}
        options={field.options ?? []}
      />
    )
  }

  if (field.kind === 'textarea') {
    return (
      <Textarea
        key={field.key}
        label={label}
        value={values[field.key] ?? ''}
        onChange={event => onChange(field.key, event.target.value)}
      />
    )
  }

  return (
    <Input
      key={field.key}
      type={field.kind === 'date' ? 'date' : 'text'}
      label={label}
      value={values[field.key] ?? ''}
      onChange={event => onChange(field.key, event.target.value)}
    />
  )
}
