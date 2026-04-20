import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { HospitalLayout } from '../../components/HospitalLayout'
import { Badge, Button, Card, EmptyState, Input, Modal, PageLoader, Textarea, showToast } from '../../components/ui'
import { FileAttachmentPreview, MedicalRecordMarkdownView } from '../../components/RecordMarkdownView'
import { VoiceToTextButton } from '../../components/VoiceToTextButton'
import { getStaffSession, signOutAndClearSessions } from '../../lib/auth'
import { HOSPITAL_ACCESS_PATH, HOSPITAL_AUTH_PATH } from '../../lib/hospitalRoutes'
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
import { closeMyAccessGrant, createMedicalRecordWithUploads, fetchPatientRecordsView, fetchStaffDashboard } from '../../lib/hidApi'
import { formatDateTime } from '../../lib/utils'
import type { MedicalRecord, MedicalRecordFile, Patient } from '../../types/database'
import type { HidStaffDashboardRequest } from '../../types/hid'

export default function DoctorPatientRecords() {
  const navigate = useNavigate()
  const { hidCode = '' } = useParams()
  const session = useMemo(() => getStaffSession(), [])
  const normalizedHidCode = hidCode.trim().toUpperCase()
  const [patient, setPatient] = useState<Patient | null>(null)
  const [records, setRecords] = useState<MedicalRecord[]>([])
  const [recordFiles, setRecordFiles] = useState<Record<string, MedicalRecordFile[]>>({})
  const [activeRequest, setActiveRequest] = useState<HidStaffDashboardRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preparingUploads, setPreparingUploads] = useState(false)
  const [recordForm, setRecordForm] = useState(createEmptyRecordForm())
  const saveLockRef = useRef(false)

  function handleRevokedAccess() {
    showToast('This patient access was closed or revoked. Return to the access page to continue.', 'error')
    navigate(HOSPITAL_ACCESS_PATH, { replace: true })
  }

  useEffect(() => {
    if (!session) {
      navigate(HOSPITAL_AUTH_PATH)
      return
    }
    if (!normalizedHidCode) {
      navigate(HOSPITAL_ACCESS_PATH)
      return
    }
    void loadPageData()
  }, [navigate, normalizedHidCode, session])

  useEffect(() => {
    if (!activeRequest?.grant_id || !normalizedHidCode || !session) return

    let active = true
    let checking = false

    const verifyGrant = async () => {
      if (!active || checking) return
      checking = true
      try {
        const dashboard = await fetchStaffDashboard({ forceRefresh: true })
        const grant = dashboard.requests.find(item =>
          item.grant_id === activeRequest.grant_id &&
          item.hid_code === normalizedHidCode &&
          item.grant_status === 'active' &&
          !!item.expires_at &&
          new Date(item.expires_at).getTime() > Date.now()
        ) ?? null

        if (!grant && active) {
          showToast('This patient access was closed or revoked. Return to the access page to continue.', 'error')
          navigate(HOSPITAL_ACCESS_PATH, { replace: true })
          return
        }

        setActiveRequest(grant)
      } catch {
        // Best effort only. Access control is still enforced by the backend.
      } finally {
        checking = false
      }
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void verifyGrant()
      }
    }, 5000)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void verifyGrant()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [activeRequest?.grant_id, navigate, normalizedHidCode, session])

  async function loadPageData() {
    if (!session || !normalizedHidCode) return
    setLoading(true)
    try {
      const [dashboard, recordsView] = await Promise.all([
        fetchStaffDashboard(),
        fetchPatientRecordsView(normalizedHidCode),
      ])

      const grant = dashboard.requests.find(item =>
        item.hid_code === normalizedHidCode &&
        item.grant_status === 'active' &&
        !!item.expires_at &&
        new Date(item.expires_at).getTime() > Date.now()
      ) ?? null

      if (!grant?.grant_id) {
        showToast('This patient record access is no longer active.', 'error')
        navigate(HOSPITAL_ACCESS_PATH)
        return
      }

      setActiveRequest(grant)
      setPatient(recordsView.patient)
      setRecords(recordsView.records)
      setRecordFiles(recordsView.recordFiles)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load the patient records.'
      showToast(message, 'error')
      navigate(HOSPITAL_ACCESS_PATH)
    } finally {
      setLoading(false)
    }
  }

  async function logout() {
    await signOutAndClearSessions()
    navigate(HOSPITAL_AUTH_PATH)
  }

  async function onAttachment(files: FileList | null) {
    if (!files || files.length === 0 || preparingUploads) return
    const selectedFiles = Array.from(files)
    const invalidFiles = getInvalidRecordUploadNames(selectedFiles)
    if (invalidFiles.length > 0) {
      showToast(`Only JPG, PNG, IMG, and PDF files can be uploaded. Remove: ${invalidFiles.join(', ')}`, 'error')
      return
    }

    setPreparingUploads(true)
    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to prepare the selected files right now.'
      showToast(message, 'error')
    } finally {
      setPreparingUploads(false)
    }
  }

  async function saveRecord() {
    if (!patient || saving || saveLockRef.current) return
    if (preparingUploads) {
      showToast('Attached files are still being prepared. Please wait a moment, then save again.', 'error')
      return
    }
    if (!recordForm.title.trim()) {
      showToast('Enter a record title before saving.', 'error')
      return
    }
    if (!hasRecordContent(recordForm)) {
      showToast('Add a doctor note, result, detail, audio note, or file before saving.', 'error')
      return
    }

    saveLockRef.current = true
    setSaving(true)
    try {
      await createMedicalRecordWithUploads({
        patientIdentifier: patient.hid_code,
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

  async function closeProfile() {
    if (!activeRequest?.grant_id) {
      navigate(HOSPITAL_ACCESS_PATH)
      return
    }

    try {
      await closeMyAccessGrant(activeRequest.grant_id)
      showToast('Patient access closed.', 'success')
      navigate(HOSPITAL_ACCESS_PATH)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to close this patient access session.'
      showToast(message, 'error')
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

  if (!session) return null
  if (loading) return <PageLoader label="Loading patient records..." />

  return (
    <HospitalLayout
      activeSection="access"
      title="Patient Records"
      subtitle="Authorized provider access to saved patient medical records."
      onLogout={() => { void logout() }}
      userName={session.fullName}
      organizationName={session.hospitalName ?? null}
      onAccessRevoked={handleRevokedAccess}
    >
      <Card style={{ borderRadius: 24, marginBottom: 18, background: 'linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)', borderColor: '#dbe8f8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>{patient?.full_name ?? hidCode}</div>
              <Badge color={activeRequest?.break_glass ? 'red' : 'green'}>
                {activeRequest?.break_glass ? 'Emergency access active' : 'Approved access active'}
              </Badge>
            </div>
            <div style={{ color: '#6b7280', fontSize: 13, marginTop: 8 }}>
              Search saved records, review attachments, and add new medical records while this grant is active.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => navigate(HOSPITAL_ACCESS_PATH)}>Back to access</Button>
            <Button variant="outline" onClick={() => void closeProfile()}>Close access</Button>
            <Button onClick={() => setOpen(true)}>Add medical record</Button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 20 }}>
          <StatCard label="Patient HID" value={patient?.hid_code ?? '-'} />
          <StatCard label="Total records" value={`${records.length}`} />
          <StatCard label="Attached files" value={`${totalFiles}`} />
          <StatCard label="Access granted" value={activeRequest?.approved_at ? formatDateTime(activeRequest.approved_at) : '-'} />
          <StatCard label="Access expires" value={activeRequest?.expires_at ? formatDateTime(activeRequest.expires_at) : '-'} />
          <StatCard label="Latest update" value={latestRecord ? formatDateTime(latestRecord.created_at) : 'No records yet'} />
        </div>

        <div style={{ marginTop: 18 }}>
          <Input
            label="Search patient records"
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
            title="No medical records saved yet"
            description="Use this page to add the first patient medical record."
            action={<Button onClick={() => setOpen(true)}>Add medical record</Button>}
          />
        </Card>
      ) : recordSections.length === 0 ? (
        <Card style={{ borderRadius: 24 }}>
          <EmptyState
            icon={<span style={{ fontSize: 28 }}>[]</span>}
            title="No records match your search"
            description="Try a different date, record title, or keyword."
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
                  <div key={record.id} style={{ border: '1px solid #edf1f5', borderRadius: 18, padding: 14 }}>
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
          <Textarea label="Doctor note" value={recordForm.roleNote} onChange={event => setRecordForm(current => ({ ...current, roleNote: event.target.value }))} />
          <Textarea label="Prescription" value={recordForm.prescription} onChange={event => setRecordForm(current => ({ ...current, prescription: event.target.value }))} />
          <Textarea label="Lab result" value={recordForm.labResult} onChange={event => setRecordForm(current => ({ ...current, labResult: event.target.value }))} />
          <Textarea label="Other" value={recordForm.other} onChange={event => setRecordForm(current => ({ ...current, other: event.target.value }))} />
          <Textarea label="Audio to text note" value={recordForm.transcriptionText} onChange={event => setRecordForm(current => ({ ...current, transcriptionText: event.target.value }))} />
          <VoiceToTextButton onTranscript={appendAudioTranscript} label="Start audio to text note" />

          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Choose file</label>
            <input type="file" multiple accept={RECORD_UPLOAD_ACCEPT} disabled={preparingUploads || saving} onChange={event => void onAttachment(event.target.files)} />
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {recordForm.uploads.map((file, index) => (
              <div key={`${file.file_name}-${index}`} style={{ display: 'grid', gap: 8 }}>
                <FileAttachmentPreview attachment={file} />
                <button type="button" onClick={() => removeUpload(index)} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 600, justifySelf: 'flex-end' }}>
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
            <Button variant="secondary" onClick={() => { setOpen(false); setRecordForm(createEmptyRecordForm()) }}>Cancel</Button>
            <Button loading={saving || preparingUploads} disabled={preparingUploads} onClick={saveRecord}>
              {preparingUploads ? 'Preparing files...' : 'Save medical record'}
            </Button>
          </div>
        </div>
      </Modal>
    </HospitalLayout>
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
