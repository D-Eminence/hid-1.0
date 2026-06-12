import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PortalShell } from '../../components/PortalShell'
import { Badge, Button, Card, EmptyState, Input, PageLoader, showToast } from '../../components/ui'
import { MedicalRecordMarkdownView } from '../../components/RecordMarkdownView'
import { AddHealthInformationModal, type HealthInformationSubmission } from '../../components/AddHealthInformationModal'
import { getPatientSession, signOutAndClearSessions } from '../../lib/auth'
import { readPatientRecordsSnapshot, seedPatientProfileCache, seedPatientRecordsCache } from '../../lib/experienceWarmup'
import {
  buildHealthInfoRecordBody,
  buildOptimisticMedicalRecord,
  countAllRecordAttachments,
  filterRecordsByQuery,
  getInvalidRecordUploadNames,
  groupRecordsByDay,
  inferLegacyCategoryFromInfoType,
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
  const cachedView = useMemo(() => (
    session ? readPatientRecordsSnapshot(session.hidCode) : null
  ), [session])
  const [records, setRecords] = useState<MedicalRecord[]>(() => cachedView?.records ?? [])
  const [recordFiles, setRecordFiles] = useState<Record<string, MedicalRecordFile[]>>(() => cachedView?.recordFiles ?? {})
  const [patient, setPatient] = useState<Patient | null>(() => cachedView?.patient ?? null)
  const [loading, setLoading] = useState(!cachedView)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preparingUploads, setPreparingUploads] = useState(false)
  const [search, setSearch] = useState('')
  const [uploads, setUploads] = useState<UploadDraft[]>([])
  const saveLockRef = useRef(false)

  useEffect(() => {
    if (!session) {
      navigate('/patient')
      return
    }
    void loadPageData(Boolean(cachedView))
  }, [cachedView, navigate, session])

  async function loadPageData(silent = false) {
    if (!session) return
    if (!silent) setLoading(true)
    try {
      const nextPage = await fetchPatientRecordsView(session.hidCode)
      seedPatientProfileCache(nextPage.patient)
      seedPatientRecordsCache(session.hidCode, nextPage)
      setPatient(nextPage.patient)
      setRecords(nextPage.records)
      setRecordFiles(nextPage.recordFiles)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load your records.'
      showToast(message, 'error')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function logout() {
    await signOutAndClearSessions()
    navigate('/patient')
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
      const newUploads = await Promise.all(selectedFiles.map(file => new Promise<UploadDraft>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({
          file_name: file.name,
          file_type: file.type || 'application/octet-stream',
          file_data_url: typeof reader.result === 'string' ? reader.result : '',
        })
        reader.onerror = () => reject(new Error(`Unable to read ${file.name}`))
        reader.readAsDataURL(file)
      })))

      setUploads(current => [...current, ...newUploads])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to prepare the selected files right now.'
      showToast(message, 'error')
    } finally {
      setPreparingUploads(false)
    }
  }

  async function saveHealthInformation(submission: HealthInformationSubmission) {
    if (!session || saving || saveLockRef.current) return

    saveLockRef.current = true
    setSaving(true)
    const category = inferLegacyCategoryFromInfoType(submission.infoType)
    const recordBody = buildHealthInfoRecordBody(submission.notes, submission.transcriptionText)
    const structuredData = Object.keys(submission.structuredData).length > 0 ? submission.structuredData : null
    const optimisticEntry = buildOptimisticMedicalRecord({
      category,
      createdBy: session.fullName,
      createdByRole: 'patient',
      hidCode: session.hidCode,
      notes: submission.notes.trim() || null,
      record: recordBody,
      title: submission.title,
      transcriptionText: submission.transcriptionText.trim() || null,
      uploads: submission.uploads,
      infoType: submission.infoType,
      structuredData,
    })

    setRecords(current => [optimisticEntry.record, ...current])
    setRecordFiles(current => ({
      ...current,
      [optimisticEntry.record.id]: optimisticEntry.attachments,
    }))
    setOpen(false)
    setUploads([])
    try {
      await createMedicalRecordWithUploads({
        patientIdentifier: session.hidCode,
        title: submission.title,
        category,
        record: recordBody,
        notes: submission.notes.trim() || null,
        uploads: submission.uploads,
        infoType: submission.infoType,
        structuredData,
      })
      await loadPageData(true)
      showToast('Health information saved.', 'success')
    } catch (error) {
      setRecords(current => current.filter(item => item.id !== optimisticEntry.record.id))
      setRecordFiles(current => {
        const next = { ...current }
        delete next[optimisticEntry.record.id]
        return next
      })
      const message = error instanceof Error ? error.message : 'Unable to save health information.'
      showToast(message, 'error')
    } finally {
      setSaving(false)
      saveLockRef.current = false
    }
  }

  function removeUpload(index: number) {
    setUploads(current => current.filter((_, currentIndex) => currentIndex !== index))
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
        notificationHidCode={session.hidCode}
      >
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
      notificationHidCode={session.hidCode}
    >
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
          <Button onClick={() => setOpen(true)}>Add health information</Button>
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
            description="Add your first piece of health information: a condition, lab result, medication, allergy, vaccination, procedure, hospital visit, or report."
            action={<Button onClick={() => setOpen(true)}>Add health information</Button>}
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

      <AddHealthInformationModal
        open={open}
        onClose={() => { setOpen(false); setUploads([]) }}
        saving={saving}
        preparingUploads={preparingUploads}
        uploads={uploads}
        onAttachment={onAttachment}
        onRemoveUpload={removeUpload}
        onSubmit={saveHealthInformation}
      />
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
