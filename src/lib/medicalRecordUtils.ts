import type { MedicalRecord, MedicalRecordFile, RecordCategory } from '../types/database'
import { formatDate, formatDateTime } from './utils'

export interface UploadDraft {
  file_name: string
  file_type: string | null
  file_data_url: string
}

export interface RecordFormValues {
  title: string
  roleNote: string
  prescription: string
  labResult: string
  other: string
  transcriptionText: string
  uploads: UploadDraft[]
}

export interface RecordDateSection {
  key: string
  label: string
  records: MedicalRecord[]
}

export const RECORD_UPLOAD_ACCEPT = '.img,.png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf'
const allowedUploadExtensions = ['.img', '.png', '.jpg', '.jpeg', '.pdf']
const allowedUploadMimeTypes = ['image/png', 'image/jpeg', 'application/pdf']

export function createEmptyRecordForm(): RecordFormValues {
  return {
    title: '',
    roleNote: '',
    prescription: '',
    labResult: '',
    other: '',
    transcriptionText: '',
    uploads: [],
  }
}

export function formatRecordCategory(category: RecordCategory): string {
  if (category === 'drug_prescription') return 'Prescription'
  if (category === 'lab_results') return 'Lab results'
  if (category === 'medical_report') return 'Medical report'
  return 'Other'
}

export function getRoleNoteLabel(role: string | null | undefined): string {
  if (role === 'doctor') return 'Doctor note'
  if (role === 'patient') return 'Patient note'
  return 'Note'
}

export function hasRecordContent(form: RecordFormValues): boolean {
  return [
    form.roleNote,
    form.prescription,
    form.labResult,
    form.other,
    form.transcriptionText,
  ].some(value => value.trim().length > 0) || form.uploads.length > 0
}

export function inferRecordCategory(form: RecordFormValues): RecordCategory {
  if (form.prescription.trim()) return 'drug_prescription'
  if (form.labResult.trim()) return 'lab_results'
  if (form.other.trim()) return 'other'
  return 'medical_report'
}

export function buildStructuredRecordBody(form: RecordFormValues): string {
  const sections: string[] = []
  if (form.prescription.trim()) {
    sections.push('Prescription', form.prescription.trim())
  }
  if (form.labResult.trim()) {
    sections.push('Lab result', form.labResult.trim())
  }
  if (form.other.trim()) {
    sections.push('Other', form.other.trim())
  }
  if (form.transcriptionText.trim()) {
    sections.push('Audio to text note', form.transcriptionText.trim())
  }
  return sections.join('\n\n').trim() || 'No additional record details provided.'
}

export function isAllowedRecordUpload(file: Pick<UploadDraft, 'file_name' | 'file_type'> | Pick<File, 'name' | 'type'>): boolean {
  const fileName = 'file_name' in file ? file.file_name : file.name
  const fileType = ('file_type' in file ? file.file_type : file.type) ?? ''
  const normalizedName = fileName.toLowerCase()
  const normalizedType = fileType.toLowerCase()
  return allowedUploadMimeTypes.includes(normalizedType) || allowedUploadExtensions.some(extension => normalizedName.endsWith(extension))
}

export function getInvalidRecordUploadNames(files: Array<Pick<File, 'name' | 'type'>>): string[] {
  return files.filter(file => !isAllowedRecordUpload(file)).map(file => file.name)
}

export function getRecordAttachmentCount(record: MedicalRecord, attachments: UploadDraft[] | Array<{ file_name: string; file_type: string | null; file_data_url: string }> = []): number {
  if (attachments.length > 0) return attachments.length
  return record.attachment_data_url ? 1 : 0
}

export function countAllRecordAttachments(records: MedicalRecord[], recordFiles: Record<string, Array<{ file_name: string; file_type: string | null; file_data_url: string }>>): number {
  return records.reduce((sum, record) => sum + getRecordAttachmentCount(record, recordFiles[record.id] ?? []), 0)
}

export function buildOptimisticRecordFiles(record: MedicalRecord, uploads: UploadDraft[]): MedicalRecordFile[] {
  return uploads.map((file, index) => ({
    id: `${record.id}-${index}`,
    record_id: record.id,
    file_name: file.file_name,
    file_type: file.file_type,
    file_data_url: file.file_data_url,
    created_at: record.created_at,
  }))
}

export function filterSessionRecords(records: MedicalRecord[], sessionStartedAt: string | null | undefined): MedicalRecord[] {
  if (!sessionStartedAt) return []
  return records.filter(record => record.created_at >= sessionStartedAt)
}

export function filterRecordsWithDocuments(records: MedicalRecord[], recordFiles: Record<string, Array<{ file_name: string; file_type: string | null; file_data_url: string }>>): MedicalRecord[] {
  return records.filter(record => {
    const attachments = recordFiles[record.id] ?? []
    if (attachments.length > 0) {
      return attachments.some(file => isAllowedRecordUpload(file))
    }
    return !!record.attachment_data_url && isAllowedRecordUpload({
      file_name: record.attachment_name ?? 'record.pdf',
      file_type: record.attachment_type,
    })
  })
}

export function recordContainsSection(record: MedicalRecord, sectionLabel: string): boolean {
  const content = `${record.record}\n${record.notes ?? ''}\n${record.transcription_text ?? ''}`.toLowerCase()
  return content.includes(sectionLabel.toLowerCase())
}

export function isLabRecord(record: MedicalRecord): boolean {
  return record.category === 'lab_results' || recordContainsSection(record, 'Lab result')
}

export function buildRecordSearchText(record: MedicalRecord): string {
  return [
    record.title,
    record.created_by,
    record.added_by_role,
    formatDate(record.created_at),
    formatDateTime(record.created_at),
    record.created_at,
    record.record,
    record.notes,
    record.transcription_text,
  ].join(' ').toLowerCase()
}

export function filterRecordsByQuery(records: MedicalRecord[], query: string): MedicalRecord[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return records
  return records.filter(record => buildRecordSearchText(record).includes(normalized))
}

export function groupRecordsByDay(records: MedicalRecord[]): RecordDateSection[] {
  const groups = new Map<string, MedicalRecord[]>()
  records.forEach(record => {
    const key = record.created_at.slice(0, 10)
    groups.set(key, [...(groups.get(key) ?? []), record])
  })

  return Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => ({
      key,
      label: formatDate(key),
      records: [...items].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    }))
}
