import React, { useState } from 'react'
import { Layout } from '../components/Layout'
import { Card, Input, Select, Button, Badge, Modal, showToast } from '../components/ui'
import { supabase } from '../lib/supabase'
import { generateHID, BLOOD_GROUPS, formatDate } from '../lib/utils'
import type { Patient } from '../types/database'

interface FormData {
  full_name: string
  dob: string
  blood_group: string
  pin: string
}
interface FormErrors { full_name?: string; dob?: string; blood_group?: string }

export default function RegisterPatient() {
  const [form, setForm] = useState<FormData>({ full_name: '', dob: '', blood_group: '', pin: '' })
  const [errors, setErrors] = useState<FormErrors>({})
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<Patient | null>(null)

  function validate(): boolean {
    const e: FormErrors = {}
    if (!form.full_name.trim()) e.full_name = 'Full name is required'
    if (!form.dob) e.dob = 'Date of birth is required'
    if (!form.blood_group) e.blood_group = 'Blood group is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)

    const hid_code = generateHID()

    // Build insert object — only include dob if the column exists
    const insertData: Record<string, unknown> = {
      full_name: form.full_name.trim(),
      blood_group: form.blood_group,
      hid_code,
      pin: form.pin || null,
    }
    // Add dob only if not empty (column may or may not exist pre-migration)
    if (form.dob) insertData.dob = form.dob

    const { data, error } = await supabase
      .from('patients')
      .insert(insertData as Parameters<typeof supabase.from>[0] extends never ? never : any)
      .select()
      .single()

    setLoading(false)
    if (error) {
      if (error.message.includes('dob') || error.message.includes('schema cache')) {
        showToast(
          'Database schema needs updating. Please run supabase/fix-migration.sql in your Supabase SQL Editor.',
          'error'
        )
      } else {
        showToast(error.message, 'error')
      }
      return
    }
    setSuccess(data)
    setForm({ full_name: '', dob: '', blood_group: '', pin: '' })
  }

  function copyHID() {
    if (!success) return
    navigator.clipboard.writeText(success.hid_code)
    showToast('HID code copied to clipboard!', 'success')
  }

  return (
    <Layout title="Register Patient" subtitle="Create a new patient Health Identity">
      <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Card>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>New Patient Registration</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
            Fill in the patient's details. A unique Health ID will be automatically generated.
          </p>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Input
                  label="Full Name *"
                  placeholder="e.g. Ibrahim Adewale"
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  error={errors.full_name}
                />
                <Input
                  label="Date of Birth *"
                  type="date"
                  value={form.dob}
                  onChange={e => setForm(f => ({ ...f, dob: e.target.value }))}
                  error={errors.dob}
                  max={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Select
                  label="Blood Group *"
                  value={form.blood_group}
                  onChange={e => setForm(f => ({ ...f, blood_group: e.target.value }))}
                  error={errors.blood_group}
                  options={BLOOD_GROUPS.map(g => ({ value: g, label: g }))}
                />
                <Input
                  label="Security PIN (Optional)"
                  type="password"
                  placeholder="4-digit PIN"
                  value={form.pin}
                  onChange={e => setForm(f => ({ ...f, pin: e.target.value.slice(0, 4) }))}
                  hint="Leave blank if no PIN required"
                  maxLength={4}
                  inputMode="numeric"
                />
              </div>
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 16px', display: 'flex', gap: 10 }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="9" cy="9" r="8" stroke="#1a6fd4" strokeWidth="1.3" fill="none"/>
                  <path d="M9 8v5M9 6v.5" stroke="#1a6fd4" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <p style={{ fontSize: 13, color: '#1e40af', lineHeight: 1.6 }}>
                  A unique <strong>HID code</strong> will be auto-generated. If you see a schema error, run
                  <code style={{ background: '#dbeafe', padding: '0 4px', borderRadius: 3 }}>supabase/fix-migration.sql</code> first.
                </p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit" loading={loading} size="lg" icon={
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                }>Register Patient</Button>
              </div>
            </div>
          </form>
        </Card>
      </div>

      <Modal open={!!success} onClose={() => setSuccess(null)} title="Patient Registered Successfully" width={500}>
        {success && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Health Identity Code</div>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '2px', color: '#1a6fd4', fontFamily: 'monospace', background: '#eff6ff', borderRadius: 10, padding: '16px 24px', border: '2px dashed #bfdbfe' }}>
                {success.hid_code}
              </div>
              <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 10 }}>Share this code with the patient. It is their permanent health identifier.</p>
            </div>
            <div style={{ background: '#f9fafb', borderRadius: 10, padding: '16px 20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Full Name', value: success.full_name ?? '—' },
                  { label: 'Date of Birth', value: success.dob ? formatDate(success.dob) : '—' },
                  { label: 'Blood Group', value: success.blood_group ?? '—' },
                  { label: 'PIN Protected', value: success.pin ? 'Yes' : 'No' },
                ].map(r => (
                  <div key={r.label}>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>{r.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{r.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <Button fullWidth onClick={copyHID} variant="secondary" icon={
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2 10V3a1 1 0 011-1h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              }>Copy HID Code</Button>
              <Button fullWidth onClick={() => setSuccess(null)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  )
}
