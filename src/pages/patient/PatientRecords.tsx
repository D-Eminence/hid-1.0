import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PatientNotificationWatcher } from '../../components/PatientNotificationWatcher'
import { PortalShell } from '../../components/PortalShell'
import { Badge, Button, Card, EmptyState, Input, Modal, PageLoader, Textarea, showToast } from '../../components/ui'
import { FileAttachmentPreview, MedicalRecordMarkdownView } from '../../components/RecordMarkdownView'
import { VoiceToTextButton } from '../../components/VoiceToTextButton'
import { getPatientSession, signOutAndClearSessions } from '../../lib/auth'
import {
  buildStructuredRecordBody,
  countAllRecordAttachments,
  createEmptyRecordForm,
  filterRecordsByQuery,
  getInvalidRecordUploadNames,
  groupRecordsByDay,
  hasRecordContent,
  inferRecordCategory,
  RECORD_UPLOAD_ACCEPT,
  type UploadDraft,
} from '../../lib/medicalRecordUtils'
import { createMedicalRecordWithUploads, fetchPatientRecordsView } from '../../lib/hidApi'
import { formatDateTime, getPersonInitials } from '../../lib/utils'
import type { MedicalRecord, MedicalRecordFile, Patient } from '../../types/database'

const patientNav = [
  { path: '/patient/profile', label: 'Home' },
  { path: '/patient/records', label: 'Records' },
  { path: '/patient/history', label: 'Access History' },
  { path: '/patient/notifications', label: 'Notifications' },
]

export default function PatientRecords() {
  const navigate = useNavigate()
  const session = useMemo(() => getPatientSession(), [])
  const [records, setRecords] = useState<MedicalRecord[]>([])
  const [recordFiles, setRecordFiles] = useState<Record<string, MedicalRecordFile[]>>({})
  const [patient, setPatient] = useState<Patient | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [recordForm, setRecordForm] = useState(createEmptyRecordForm())
  const saveLockRef = useRef(false)

  useEffect(() => {
    if (!session) {
      navigate('/patient')
      return
    }
    void loadPageData()
  }, [navigate, session])

  async function loadPageData() {
    if (!session) return
    setLoading(true)
    try {
      const nextPage = await fetchPatientRecordsView(session.hidCode)
      setPatient(nextPage.patient)
      setRecords(nextPage.records)
      setRecordFiles(nextPage.recordFiles)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load your records.'
      showToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function logout() {
    await signOutAndClearSessions()
    navigate('/patient')
  }

  async function onAttachment(files: FileList | null) {
    if (!files || files.length === 0) return
    const selectedFiles = Array.from(files)
    const invalidFiles = getInvalidRecordUploadNames(selectedFiles)
    if (invalidFiles.length > 0) {
      showToast(`Only JPG, PNG, IMG, and PDF files can be uploaded. Remove: ${invalidFiles.join(', ')}`, 'error')
      return
    }

    const uploads = await Promise.all(selectedFiles.map(file => new Promise<UploadDraft>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({
        file_name: file.name,
        file_type: file.type || 'application/octet-stream',
        file_data_url: typeof reader.result === 'string' ? reader.result : '',
      })
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}`))
      reader.readAsDataURL(file)
    })))

    setRecordForm(current => ({
      ...current,
      uploads: [...current.uploads, ...uploads],
    }))
  }

  async function savePatientRecord() {
    if (!session || saving || saveLockRef.current) return
    if (!recordForm.title.trim()) {
      showToast('Enter a record title before saving.', 'error')
      return
    }
    if (!hasRecordContent(recordForm)) {
      showToast('Add a note, result, detail, audio note, or file before saving.', 'error')
      return
    }

    saveLockRef.current = true
    setSaving(true)
    try {
      await createMedicalRecordWithUploads({
        patientIdentifier: session.hidCode,
        title: recordForm.title.trim(),
        category: inferRecordCategory(recordForm),
        record: buildStructuredRecordBody(recordForm),
        notes: recordForm.roleNote.trim() || null,
        uploads: recordForm.uploads,
      })
      await loadPageData()
      setOpen(false)
      setRecordForm(createEmptyRecordForm())
      showToast('Medical record saved.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save the medical record.'
      showToast(message, 'error')
    } finally {
      setSaving(false)
      saveLockRef.current = false
    }
  }

  function appendAudioTranscript(transcript: string) {
    setRecordForm(current => ({
      ...current,
      transcriptionText: `${current.transcriptionText}${current.transcriptionText.trim() ? '\n' : ''}${transcript}`.trim(),
    }))
  }

  function removeUpload(index: number) {
    setRecordForm(current => ({ ...current, uploads: current.uploads.filter((_, currentIndex) => currentIndex !== index) }))
  }

  const filteredRecords = useMemo(() => filterRecordsByQuery(records, search), [records, search])
  const recordSections = useMemo(() => groupRecordsByDay(filteredRecords), [filteredRecords])
  const totalFiles = useMemo(() => countAllRecordAttachments(records, recordFiles), [recordFiles, records])
  const latestRecord = records[0]
  const resultSummary = `${filteredRecords.length} record${filteredRecords.length === 1 ? '' : 's'} shown in newest to oldest order.`
  const patientInitials = getPersonInitials(patient?.full_name ?? session?.fullName ?? '')

  if (!session) return null
  if (loading) {
    return (
      <PortalShell
        title="Patient records"
        subtitle="Search, review, and add saved medical records."
        items={patientNav}
        onLogout={() => { void logout() }}
        userName={patient?.full_name ?? session.fullName}
        avatarUrl={patient?.photo_url}
        notificationPath="/patient/notifications"
      >
        <PatientNotificationWatcher hidCode={session.hidCode} />
        <PageLoader label="Loading your records..." />
      </PortalShell>
    )
  }

  return (
    <PortalShell
      title="Patient records"
      subtitle="Search, review, and add saved medical records."
      items={patientNav}
      onLogout={() => { void logout() }}
      userName={patient?.full_name ?? session.fullName}
      avatarUrl={patient?.photo_url}
      notificationPath="/patient/notifications"
    >
      <PatientNotificationWatcher hidCode={session.hidCode} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', overflow: 'hidden', background: 'linear-gradient(180deg, #f4f7fb 0%, #dfe8f4 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#68758b' }}>
          {patient?.photo_url ? <img src={patient.photo_url} alt={session.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : patientInitials}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{session.fullName}</div>
          <div style={{ color: '#8da031', fontSize: 11 }}>{session.hidCode}</div>
        </div>
      </div>

      <Card style={{ borderRadius: 24, marginBottom: 18, background: 'linear-gradient(180deg, #fbfdff 0%, #f4f9ff 100%)', borderColor: '#dbe8f8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Saved medical records</div>
            <div style={{ color: '#6b7280', fontSize: 13, marginTop: 8, maxWidth: 520 }}>
              New records appear first. You can search by date, record title, or any keyword saved in a record.
            </div>
          </div>
          <Button onClick={() => setOpen(true)}>Add medical record</Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 20 }}>
          <StatCard label="Total records" value={`${records.length}`} />
          <StatCard label="Attached files" value={`${totalFiles}`} />
          <StatCard label="Latest update" value={latestRecord ? formatDateTime(latestRecord.created_at) : 'No records yet'} />
        </div>

        <div style={{ marginTop: 18 }}>
          <Input
            label="Search saved records"
            placeholder="Search by date, title, or keyword"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
          <div style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>{resultSummary}</div>
        </div>
      </Card>

      {records.length === 0 ? (
        <Card style={{ borderRadius: 24 }}>
          <EmptyState
            icon={<span style={{ fontSize: 28 }}>[]</span>}
            title="No medical records yet"
            description="Add your first medical record with notes, prescriptions, lab results, audio text, or files."
            action={<Button onClick={() => setOpen(true)}>Add medical record</Button>}
          />
        </Card>
      ) : recordSections.length === 0 ? (
        <Card style={{ borderRadius: 24 }}>
          <EmptyState
            icon={<span style={{ fontSize: 28 }}>[]</span>}
            title="No records match your search"
            description="Try a different date, title, or keyword."
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {recordSections.map(section => (
            <Card key={section.key} style={{ borderRadius: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{section.label}</div>
                <Badge color="blue">{section.records.length} saved</Badge>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
                {section.records.map(record => (
                  <div key={record.id} style={{ border: '1px solid #edf1f5', borderRadius: 18, padding: 14, background: '#fff' }}>
                    <MedicalRecordMarkdownView record={record} attachments={recordFiles[record.id] ?? []} />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => { setOpen(false); setRecordForm(createEmptyRecordForm()) }} title="Add medical record" width={780}>
        <div style={{ display: 'grid', gap: 14 }}>
          <Input label="Record title" value={recordForm.title} onChange={event => setRecordForm(current => ({ ...current, title: event.target.value }))} />
          <Textarea label="Patient note" value={recordForm.roleNote} onChange={event => setRecordForm(current => ({ ...current, roleNote: event.target.value }))} />
          <Textarea label="Prescription" value={recordForm.prescription} onChange={event => setRecordForm(current => ({ ...current, prescription: event.target.value }))} />
          <Textarea label="Lab result" value={recordForm.labResult} onChange={event => setRecordForm(current => ({ ...current, labResult: event.target.value }))} />
          <Textarea label="Other" value={recordForm.other} onChange={event => setRecordForm(current => ({ ...current, other: event.target.value }))} />
          <Textarea label="Audio to text note" value={recordForm.transcriptionText} onChange={event => setRecordForm(current => ({ ...current, transcriptionText: event.target.value }))} />
          <VoiceToTextButton onTranscript={appendAudioTranscript} label="Start audio to text note" />

          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Choose file</label>
            <input type="file" multiple accept={RECORD_UPLOAD_ACCEPT} onChange={event => void onAttachment(event.target.files)} />
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {recordForm.uploads.map((file, index) => (
              <div key={`${file.file_name}-${index}`} style={{ display: 'grid', gap: 8 }}>
                <FileAttachmentPreview attachment={file} />
                <button onClick={() => removeUpload(index)} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 600, justifySelf: 'flex-end' }}>
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
            <Button variant="secondary" onClick={() => { setOpen(false); setRecordForm(createEmptyRecordForm()) }}>Cancel</Button>
            <Button loading={saving} onClick={savePatientRecord}>Save medical record</Button>
          </div>
        </div>
      </Modal>
    </PortalShell>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderRadius: 18, border: '1px solid #dbe8f8', background: '#fff', padding: 16 }}>
      <div style={{ color: '#6b7280', fontSize: 12 }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 18, fontWeight: 700, color: '#111827' }}>{value}</div>
    </div>
  )
}
