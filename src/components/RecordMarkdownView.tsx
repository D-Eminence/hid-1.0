import React from 'react'
import { Badge } from './ui'
import { formatHealthInfoType, getHealthInfoTypeConfig, getRecordSourceBadge, getRoleNoteLabel } from '../lib/medicalRecordUtils'
import { formatDate, formatDateTime } from '../lib/utils'
import type { MedicalRecord, MedicalRecordFile, PatientNote } from '../types/database'

function markdownShell(lines: string[]) {
  const renderedLines = lines.join('\n').split('\n')

  return (
    <div
      style={{
        margin: 0,
        background: '#0f172a',
        color: '#e2e8f0',
        padding: 16,
        borderRadius: 12,
        lineHeight: 1.7,
        fontSize: 13,
        display: 'grid',
        gap: 6,
      }}
    >
      {renderedLines.map((line, index) => {
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
        if (headingMatch) {
          const level = headingMatch[1].length
          const fontSize = level === 1 ? 18 : level === 2 ? 15 : 14
          return (
            <div key={`line-${index}`} style={{ fontWeight: 700, fontSize, color: '#f8fafc', marginTop: level === 1 ? 4 : 8 }}>
              {headingMatch[2]}
            </div>
          )
        }

        if (!line.trim()) {
          return <div key={`line-${index}`} style={{ height: 4 }} />
        }

        if (line.startsWith('- ')) {
          return (
            <div key={`line-${index}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#dbe7f3' }}>
              <span style={{ color: '#93c5fd', lineHeight: 1.7 }}>•</span>
              <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{line.slice(2)}</span>
            </div>
          )
        }

        if (line.startsWith('> ')) {
          return (
            <div
              key={`line-${index}`}
              style={{
                borderLeft: '3px solid #60a5fa',
                paddingLeft: 10,
                color: '#cbd5e1',
                fontStyle: 'italic',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {line.slice(2)}
            </div>
          )
        }

        return (
          <div key={`line-${index}`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#e2e8f0' }}>
            {line}
          </div>
        )
      })}
    </div>
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

export function RecordSourceBadge({ record }: { record: MedicalRecord }) {
  const source = getRecordSourceBadge(record)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12, color: '#6b7280' }}>
      <Badge color={source.color}>{source.label}</Badge>
      <span>{record.created_by}</span>
      {record.created_by_org && <span>· {record.created_by_org}</span>}
      <span>· {formatDateTime(record.created_at)}</span>
    </div>
  )
}

function formatStructuredFieldValue(value: unknown, kind: string | undefined, options?: { value: string; label: string }[]) {
  const raw = String(value)
  if (kind === 'date') return formatDate(raw)
  if (kind === 'select') return options?.find(option => option.value === raw)?.label ?? raw
  return raw
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

  const structuredData = record.structured_data
  const typeConfig = getHealthInfoTypeConfig(record.info_type)
  const structuredEntries = structuredData ? Object.entries(structuredData) : []

  const lines = [
    `# ${record.title}`,
    '',
    `- Type: ${formatHealthInfoType(record.info_type, record.category)}`,
    `- Saved by: ${record.created_by}`,
    `- Saved at: ${formatDateTime(record.created_at)}`,
    `- Files attached: ${allAttachments.length}`,
  ]

  if (structuredEntries.length > 0) {
    lines.push('', '## Details')
    structuredEntries.forEach(([key, value]) => {
      const field = typeConfig?.fields.find(item => item.key === key)
      const label = field?.label ?? key
      lines.push(`- ${label}: ${formatStructuredFieldValue(value, field?.kind, field?.options)}`)
    })
  }

  lines.push('', `## Record details`, record.record || '-')

  if (record.notes) {
    lines.push('', `## ${getRoleNoteLabel(record.added_by_role)}`, record.notes)
  }

  if (record.transcription_text) {
    lines.push('', '## Audio to text note', record.transcription_text)
  }

  lines.push('', '> Saved medical records are read-only.')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <RecordSourceBadge record={record} />
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
