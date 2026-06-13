import React from 'react'
import { badgeMap } from './ui'
import { formatHealthInfoType, getHealthInfoTypeConfig, getRecordContributorLabel } from '../lib/medicalRecordUtils'
import { formatDate } from '../lib/utils'
import type { MedicalRecord, MedicalRecordFile } from '../types/database'

interface RecordSummaryCardProps {
  record: MedicalRecord
  attachments: MedicalRecordFile[]
  onClick: () => void
}

export function RecordSummaryCard({ record, attachments, onClick }: RecordSummaryCardProps) {
  const previewAttachment = attachments.length > 0
    ? attachments[0]
    : (record.attachment_data_url ? {
        file_name: record.attachment_name ?? 'uploaded-file',
        file_type: record.attachment_type,
        file_data_url: record.attachment_data_url,
      } : null)

  const typeConfig = getHealthInfoTypeConfig(record.info_type)
  const accentColors = badgeMap[typeConfig?.accent ?? 'gray']
  const typeLabel = formatHealthInfoType(record.info_type, record.category)

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        background: '#fff',
        border: '1px solid #f2f2f2',
        borderRadius: 8,
        padding: 12,
        cursor: 'pointer',
        boxShadow: '0 1px 24px rgba(194, 201, 205, 0.08)',
      }}
    >
      <div style={{ height: 180, borderRadius: 6, border: '1px solid #f2f2f2', overflow: 'hidden', background: '#f6f7f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {previewAttachment && (previewAttachment.file_type ?? '').startsWith('image/') ? (
          <img
            src={previewAttachment.file_data_url}
            alt={previewAttachment.file_name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : previewAttachment ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#9ca3af' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>PDF</span>
          </div>
        ) : (
          <div style={{ width: 48, height: 48, borderRadius: 12, background: accentColors.bg, color: accentColors.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18 }}>
            {typeLabel.charAt(0)}
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', fontSize: 13, color: '#484f58', lineHeight: 1.6 }}>
        <span>• {typeLabel}</span>
        <span>• Added by {getRecordContributorLabel(record)}</span>
        <span>• {formatDate(record.created_at)}</span>
      </div>
    </button>
  )
}
