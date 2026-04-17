import React from 'react'
import { formatRecordCategory, getRoleNoteLabel } from '../lib/medicalRecordUtils'
import { formatDateTime } from '../lib/utils'
import type { MedicalRecord, MedicalRecordFile, PatientNote } from '../types/database'

function markdownShell(lines: string[]) {
  return (
    <pre
      style={{
        margin: 0,
        background: '#0f172a',
        color: '#e2e8f0',
        padding: 16,
        borderRadius: 12,
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
        lineHeight: 1.7,
        fontSize: 13,
      }}
    >
      {lines.join('\n')}
    </pre>
  )
}

export function FileAttachmentPreview({ attachment }: { attachment: { file_name: string; file_type: string | null; file_data_url: string } }) {
  const safeType = attachment.file_type ?? ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff' }}>
      <a href={attachment.file_data_url} download={attachment.file_name} target="_blank" rel="noreferrer" style={{ color: '#1a6fd4', fontWeight: 600 }}>
        {attachment.file_name}
      </a>
      {safeType.startsWith('image/') && (
        <img
          src={attachment.file_data_url}
          alt={attachment.file_name}
          style={{ width: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 12, border: '1px solid #e5e7eb', background: '#f8fafc' }}
        />
      )}
      {safeType === 'application/pdf' && (
        <iframe
          src={attachment.file_data_url}
          title={attachment.file_name}
          style={{ width: '100%', minHeight: 360, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}
        />
      )}
      {safeType.startsWith('audio/') && (
        <audio controls style={{ width: '100%' }}>
          <source src={attachment.file_data_url} type={safeType} />
        </audio>
      )}
    </div>
  )
}

export function MedicalRecordMarkdownView({ record, attachments = [] }: { record: MedicalRecord; attachments?: MedicalRecordFile[] }) {
  const allAttachments = attachments.length > 0
    ? attachments
    : (record.attachment_data_url ? [{
        id: `legacy-${record.id}`,
        record_id: record.id,
        file_name: record.attachment_name ?? 'uploaded-file',
        file_type: record.attachment_type,
        file_data_url: record.attachment_data_url,
        created_at: record.created_at,
      }] : [])
  const lines = [
    `# ${record.title}`,
    '',
    `- Category: ${formatRecordCategory(record.category)}`,
    `- Saved by: ${record.created_by}`,
    `- Saved at: ${formatDateTime(record.created_at)}`,
    `- Files attached: ${allAttachments.length}`,
    '',
    `## Record details`,
    record.record || '-',
  ]

  if (record.notes) {
    lines.push('', `## ${getRoleNoteLabel(record.added_by_role)}`, record.notes)
  }

  if (record.transcription_text) {
    lines.push('', '## Audio to text note', record.transcription_text)
  }

  lines.push('', '> Saved medical records are read-only.')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {markdownShell(lines)}
      {allAttachments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {allAttachments.map(attachment => <FileAttachmentPreview key={attachment.id} attachment={attachment} />)}
        </div>
      )}
    </div>
  )
}

export function PatientNoteMarkdownView({ note }: { note: PatientNote }) {
  return markdownShell([
    `# Patient note`,
    '',
    `- Created by: ${note.created_by}`,
    `- Saved at: ${formatDateTime(note.created_at)}`,
    '',
    `## Note`,
    note.note,
  ])
}
