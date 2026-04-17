import React, { useState } from 'react'
import { Layout } from '../components/Layout'
import { Card, Input, Textarea, Button, Badge, Modal, EmptyState, showToast } from '../components/ui'
import { supabase } from '../lib/supabase'
import { formatDate, formatDateTime, timeAgo } from '../lib/utils'
import type { Patient, MedicalRecord } from '../types/database'

interface AccessedData {
  patient: Patient
  records: MedicalRecord[]
}

type AccessLogInsert = {
  hid_code: string
  accessed_by: string
  access_type: 'standard' | 'emergency'
  reason: string | null
}

export default function DoctorAccess() {
  const [hidCode, setHidCode] = useState('')
  const [pin, setPin] = useState('')
  const [doctorName, setDoctorName] = useState('')
  const [reason, setReason] = useState('')
  const [isEmergency, setIsEmergency] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AccessedData | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Add record state
  const [showAddRecord, setShowAddRecord] = useState(false)
  const [recordTitle, setRecordTitle] = useState('')
  const [recordContent, setRecordContent] = useState('')
  const [addingRecord, setAddingRecord] = useState(false)

  function validate() {
    const e: Record<string, string> = {}
    if (!hidCode.trim()) e.hid = 'HID code is required'
    if (!doctorName.trim()) e.doctor = 'Doctor name is required for audit logging'
    if (isEmergency && !reason.trim()) e.reason = 'Reason is required for emergency access'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleAccess(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)
    setData(null)

    // 1. Find patient
    const { data: patientData, error: pErr } = await supabase
      .from('patients')
      .select('*')
      .eq('hid_code', hidCode.trim().toUpperCase())
      .single()
    const patient = patientData as Patient | null

    if (pErr || !patient) {
      setErrors({ hid: 'No patient found with this HID code' })
      setLoading(false)
      return
    }

    // 2. Validate PIN if set
    if (patient.pin && pin !== patient.pin) {
      setErrors({ pin: 'Incorrect PIN' })
      setLoading(false)
      return
    }

    // 3. Fetch medical records
    const { data: recordsData } = await supabase
      .from('medical_records')
      .select('*')
      .eq('hid_code', hidCode.trim().toUpperCase())
      .order('created_at', { ascending: false })
    const records = (recordsData ?? []) as MedicalRecord[]

    // 4. Log access
    const accessLog: AccessLogInsert = {
      hid_code: patient.hid_code,
      accessed_by: doctorName.trim(),
      access_type: isEmergency ? 'emergency' : 'standard',
      reason: reason || null,
    }
    await supabase.from('access_logs').insert(accessLog as any)

    setData({ patient, records: records ?? [] })
    setLoading(false)
    showToast(`Access granted. Patient: ${patient.full_name}`, 'success')
  }

  async function handleAddRecord(e: React.FormEvent) {
    e.preventDefault()
    if (!data || !recordTitle.trim() || !recordContent.trim()) return
    setAddingRecord(true)

    const { data: newRecord, error } = await supabase
      .from('medical_records')
      .insert({
        hid_code: data.patient.hid_code,
        title: recordTitle.trim(),
        record: recordContent.trim(),
        created_by: doctorName,
      } as any)
      .select()
      .single()
    const createdRecord = newRecord as MedicalRecord | null

    setAddingRecord(false)
    if (error) { showToast(error.message, 'error'); return }

    if (!createdRecord) {
      showToast('Medical record could not be created', 'error')
      return
    }

    setData(d => d ? { ...d, records: [createdRecord, ...d.records] } : d)
    setRecordTitle('')
    setRecordContent('')
    setShowAddRecord(false)
    showToast('Medical record added successfully', 'success')
  }

  return (
    <Layout title="Doctor Access Portal" subtitle="Access and manage patient records securely">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Access form */}
        <Card>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Patient Record Lookup</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
            Enter the patient's HID code to retrieve their medical records. All access is logged automatically.
          </p>

          <form onSubmit={handleAccess}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Input
                  label="HID Code *"
                  placeholder="e.g. HID-ABCD-EFGH-1234"
                  value={hidCode}
                  onChange={e => setHidCode(e.target.value.toUpperCase())}
                  error={errors.hid}
                  style={{ fontFamily: 'monospace', letterSpacing: '1px' }}
                />
                <Input
                  label="PIN (if applicable)"
                  type="password"
                  placeholder="Leave blank if no PIN"
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  error={errors.pin}
                  maxLength={4}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Input
                  label="Your Name / Doctor Name *"
                  placeholder="Dr. Aisha Johnson"
                  value={doctorName}
                  onChange={e => setDoctorName(e.target.value)}
                  error={errors.doctor}
                  hint="Required for audit log"
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Access Type</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[
                      { val: false, label: 'Standard', color: '#1a6fd4', bg: '#e8f1fc' },
                      { val: true, label: '🚨 Emergency', color: '#dc2626', bg: '#fee2e2' },
                    ].map(opt => (
                      <button key={String(opt.val)} type="button"
                        onClick={() => setIsEmergency(opt.val)}
                        style={{
                          flex: 1, height: 42, border: `1.5px solid ${isEmergency === opt.val ? opt.color : '#e5e7eb'}`,
                          borderRadius: 8, background: isEmergency === opt.val ? opt.bg : '#fff',
                          color: isEmergency === opt.val ? opt.color : '#6b7280',
                          fontWeight: 500, fontSize: 13, transition: 'all 0.15s'
                        }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {isEmergency && (
                <Textarea
                  label="Reason for Emergency Access *"
                  placeholder="Describe the emergency situation requiring immediate access..."
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  error={errors.reason}
                />
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit" loading={loading} size="lg"
                  variant={isEmergency ? 'danger' : 'primary'}
                  icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>}>
                  {isEmergency ? 'Emergency Access' : 'Access Records'}
                </Button>
              </div>
            </div>
          </form>
        </Card>

        {/* Patient data */}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'fadeIn 0.3s ease' }}>
            <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

            {/* Patient info card */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#e8f1fc', color: '#1a6fd4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700 }}>
                    {(data.patient.full_name ?? '?').split(' ').filter(Boolean).map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' }}>{data.patient.full_name}</h3>
                    <div style={{ fontSize: 13, fontFamily: 'monospace', color: '#1a6fd4', marginTop: 2 }}>{data.patient.hid_code}</div>
                  </div>
                </div>
                <Badge color="blue">{data.patient.blood_group}</Badge>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, background: '#f9fafb', borderRadius: 10, padding: 16 }}>
                {[
                  { label: 'Date of Birth', value: formatDate(data.patient.dob) },
                  { label: 'Blood Group', value: data.patient.blood_group },
                  { label: 'PIN Protected', value: data.patient.pin ? 'Yes' : 'No' },
                  { label: 'Registered', value: formatDate(data.patient.created_at) },
                ].map(r => (
                  <div key={r.label}>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{r.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{r.value}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Medical records */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>Medical Records</h3>
                  <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 2 }}>{data.records.length} record{data.records.length !== 1 ? 's' : ''} found</p>
                </div>
                <Button onClick={() => setShowAddRecord(true)} size="sm" icon={
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                }>Add Record</Button>
              </div>

              {data.records.length === 0 ? (
                <EmptyState
                  icon={<svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="5" y="4" width="30" height="32" rx="4" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M13 14h14M13 20h10M13 26h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                  title="No records yet"
                  description="No medical records have been added for this patient."
                  action={<Button onClick={() => setShowAddRecord(true)} size="sm">Add First Record</Button>}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {data.records.map((rec, i) => (
                    <div key={rec.id} style={{
                      border: '1px solid #e5e7eb', borderRadius: 10, padding: 16,
                      borderLeft: `4px solid ${i === 0 ? '#1a6fd4' : '#e5e7eb'}`
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <h4 style={{ fontWeight: 600, fontSize: 14 }}>{rec.title}</h4>
                        <div style={{ fontSize: 12, color: '#9ca3af', display: 'flex', gap: 12, alignItems: 'center' }}>
                          <span>By: <strong>{rec.created_by}</strong></span>
                          <span>{timeAgo(rec.created_at)}</span>
                        </div>
                      </div>
                      <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{rec.record}</p>
                      <p style={{ fontSize: 11, color: '#d1d5db', marginTop: 8 }}>{formatDateTime(rec.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* Add Record Modal */}
      <Modal open={showAddRecord} onClose={() => setShowAddRecord(false)} title="Add Medical Record">
        <form onSubmit={handleAddRecord} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data && (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
              <span style={{ color: '#9ca3af' }}>Patient: </span>
              <strong>{data.patient.full_name}</strong>
              <span style={{ fontFamily: 'monospace', color: '#1a6fd4', marginLeft: 8, fontSize: 12 }}>{data.patient.hid_code}</span>
            </div>
          )}
          <Input
            label="Record Title *"
            placeholder="e.g. Blood Test Results, Diagnosis, Prescription"
            value={recordTitle}
            onChange={e => setRecordTitle(e.target.value)}
          />
          <Textarea
            label="Record Details *"
            placeholder="Enter the full medical record details, observations, or notes..."
            value={recordContent}
            onChange={e => setRecordContent(e.target.value)}
            style={{ minHeight: 120 }}
          />
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Button variant="outline" onClick={() => setShowAddRecord(false)} type="button">Cancel</Button>
            <Button type="submit" loading={addingRecord} disabled={!recordTitle.trim() || !recordContent.trim()}>
              Save Record
            </Button>
          </div>
        </form>
      </Modal>
    </Layout>
  )
}
