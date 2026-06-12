import React, { useState } from 'react'
import { Button, Input, Modal, Select, Textarea, showToast } from './ui'
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

export interface HealthInformationSubmission {
  infoType: string
  title: string
  structuredData: Record<string, unknown>
  notes: string
  transcriptionText: string
  uploads: UploadDraft[]
}

interface AddHealthInformationModalProps {
  open: boolean
  onClose: () => void
  saving: boolean
  preparingUploads: boolean
  uploads: UploadDraft[]
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
  onAttachment,
  onRemoveUpload,
  onSubmit,
}: AddHealthInformationModalProps) {
  const [selectedType, setSelectedType] = useState<HealthInfoTypeConfig | null>(null)
  const [values, setValues] = useState<HealthInfoValues>({})
  const [notes, setNotes] = useState('')
  const [transcriptionText, setTranscriptionText] = useState('')

  function reset() {
    setSelectedType(null)
    setValues({})
    setNotes('')
    setTranscriptionText('')
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
    })
    reset()
  }

  const modalTitle = selectedType ? selectedType.label : 'Add health information'

  return (
    <Modal open={open} onClose={handleClose} title={modalTitle} width={780}>
      {!selectedType ? (
        <div>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: -4, marginBottom: 18 }}>
            Choose the type of health information you want to add to your record.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            {HEALTH_INFO_TYPES.map(type => (
              <button
                key={type.id}
                type="button"
                onClick={() => selectType(type)}
                style={{
                  textAlign: 'left',
                  borderRadius: 16,
                  border: '1px solid #edf1f5',
                  borderTop: `4px solid ${type.accent}`,
                  background: '#fff',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
                  padding: 16,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: `${type.accent}1a`,
                    color: type.accent,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {type.label.charAt(0)}
                </span>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{type.label}</div>
                <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>{type.description}</div>
              </button>
            ))}
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
