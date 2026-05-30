import React, { useMemo, useState } from 'react'
import { Layout } from '../components/Layout'
import { Badge, Button, Card, Input, Select, Spinner, Textarea } from '../components/ui'
import { useOutreach } from '../hooks/useOutreach'
import { OUTREACH_LOGIN_PATH } from '../lib/outreachRoutes'
import { useNavigate } from 'react-router-dom'

const sexOptions = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
]

const serviceOptions = [
  { value: 'registration', label: 'Registration' },
  { value: 'vitals', label: 'Vitals' },
  { value: 'vaccination', label: 'Vaccination' },
  { value: 'lab_sample', label: 'Lab sample' },
  { value: 'referral', label: 'Referral' },
]

const consentMethodOptions = [
  { value: 'pin', label: 'PIN' },
  { value: 'signature', label: 'Signature' },
  { value: 'verbal_witness', label: 'Verbal witness' },
]

export default function OutreachPage() {
  const navigate = useNavigate()
  const outreach = useOutreach()

  React.useEffect(() => {
    if (outreach.needsAuth) {
      navigate(OUTREACH_LOGIN_PATH, { replace: true })
    }
  }, [outreach.needsAuth, navigate])

  const [form, setForm] = useState({
    full_name: '',
    sex: 'female',
    age_years: 0,
    phone: '',
    service_type: 'registration',
    notes: '',
    consent_method: 'pin',
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const canRegister = outreach.role !== 'admin'
  const canManageCampaign = outreach.role === 'admin'

  const recentEncounters = useMemo(() => outreach.encounters.slice(0, 5), [outreach.encounters])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    if (!form.full_name.trim()) {
      setFormError('Enter the patient name.')
      return
    }
    if (form.age_years < 0) {
      setFormError('Enter a valid age.')
      return
    }

    setSubmitting(true)
    try {
      await outreach.addEncounter({
        full_name: form.full_name.trim(),
        sex: form.sex as 'female' | 'male' | 'other',
        age_years: Number(form.age_years),
        phone: form.phone.trim() || null,
        service_type: form.service_type as any,
        notes: form.notes.trim() || null,
        consent_method: form.consent_method as 'pin' | 'signature' | 'verbal_witness' | null,
      })
      setForm({ ...form, full_name: '', age_years: 0, phone: '', notes: '' })
    } catch (error_) {
      setFormError(error_ instanceof Error ? error_.message : 'Unable to register encounter.')
    } finally {
      setSubmitting(false)
    }
  }

  if (outreach.loading) {
    return (
      <Layout title="Outreach" subtitle="Loading outreach workspace...">
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner /></div>
      </Layout>
    )
  }

  if (outreach.error) {
    return (
      <Layout title="Outreach" subtitle="Outreach access">
        <Card style={{ maxWidth: 640, margin: '0 auto', padding: 32 }}>
          <h2 style={{ marginBottom: 16 }}>Unable to open outreach</h2>
          <p style={{ marginBottom: 16, color: '#4b5563' }}>{outreach.error}</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => navigate(OUTREACH_LOGIN_PATH)}>Sign in</Button>
            <Button variant="primary" onClick={() => window.location.reload()}>Retry</Button>
          </div>
        </Card>
      </Layout>
    )
  }

  return (
    <Layout title="Outreach" subtitle={outreach.activeCampaign?.name ?? 'No active outreach campaign selected'}>
      <div style={{ display: 'grid', gap: 24 }}>
        <div style={{ display: 'grid', gap: 18, gridTemplateColumns: '1fr 320px' }}>
          <Card style={{ padding: 24 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#1a6fd4' }}>Outreach workspace</p>
                <h2 style={{ margin: '10px 0 0', fontSize: 26 }}>{outreach.activeCampaign?.name ?? 'No campaign selected'}</h2>
                <p style={{ margin: '10px 0 0', color: '#6b7280' }}>{outreach.activeCampaign?.org} · {outreach.activeCampaign?.location}</p>
              </div>
              <Badge color={outreach.activeCampaign?.status === 'active' ? 'green' : outreach.activeCampaign?.status === 'planned' ? 'blue' : 'gray'}>{outreach.activeCampaign?.status ?? 'unavailable'}</Badge>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(140px, 1fr))', gap: 12, marginTop: 24 }}>
              <div style={{ padding: 16, borderRadius: 14, background: '#f8fafc' }}>
                <p style={{ margin: 0, color: '#6b7280', fontSize: 12 }}>Encounters</p>
                <p style={{ margin: '8px 0 0', fontSize: 24, fontWeight: 700 }}>{outreach.metrics.registered}</p>
              </div>
              <div style={{ padding: 16, borderRadius: 14, background: '#f8fafc' }}>
                <p style={{ margin: 0, color: '#6b7280', fontSize: 12 }}>Queued sync</p>
                <p style={{ margin: '8px 0 0', fontSize: 24, fontWeight: 700 }}>{outreach.metrics.queued}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 24 }}>
              <Button variant="primary" onClick={outreach.simulateSync}>Sync now</Button>
              <Button variant="secondary" onClick={outreach.signOut}>Sign out</Button>
            </div>
          </Card>
          <Card style={{ padding: 24 }}>
            <h3 style={{ marginTop: 0 }}>Worker</h3>
            <p style={{ margin: '6px 0 0', color: '#6b7280' }}>{outreach.worker?.display_name}</p>
            <p style={{ margin: '6px 0 0', color: '#6b7280' }}>Role: {outreach.worker?.role}</p>
            <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
              <Card style={{ padding: 16, background: '#eef2ff' }}><strong>Status</strong><div>{outreach.connection}</div></Card>
              <Card style={{ padding: 16, background: '#f8fafc' }}><strong>Campaign</strong><div>{outreach.activeCampaign?.name ?? 'None'}</div></Card>
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gap: 24, gridTemplateColumns: '1.3fr 0.7fr' }}>
          <Card style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
              <div>
                <h3 style={{ margin: 0 }}>Register a new encounter</h3>
                <p style={{ margin: '6px 0 0', color: '#6b7280' }}>Capture field details and queue record for sync.</p>
              </div>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
              <Input label="Full name" value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Select label="Sex" options={sexOptions} value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })} />
                <Input label="Age" type="number" value={form.age_years} onChange={(event) => setForm({ ...form, age_years: Number(event.target.value) })} />
              </div>
              <Input label="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              <Select label="Service type" options={serviceOptions} value={form.service_type} onChange={(event) => setForm({ ...form, service_type: event.target.value })} />
              <Textarea label="Notes" value={form.notes} rows={4} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
              <Select label="Consent captured" options={consentMethodOptions} value={form.consent_method} onChange={(event) => setForm({ ...form, consent_method: event.target.value })} />
              {formError && <p style={{ color: '#dc2626' }}>{formError}</p>}
              <Button type="submit" loading={submitting} disabled={!canRegister}>Register encounter</Button>
            </form>
          </Card>

          <div style={{ display: 'grid', gap: 24 }}>
            <Card style={{ padding: 24 }}>
              <h3 style={{ marginTop: 0 }}>Recent encounters</h3>
              {recentEncounters.length === 0 ? (
                <p style={{ color: '#6b7280' }}>No recent encounters captured yet.</p>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {recentEncounters.map((item) => (
                    <div key={item.id} style={{ padding: 16, borderRadius: 14, border: '1px solid #e5e7eb', background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <strong>{item.full_name}</strong>
                          <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>{item.service_type}</p>
                        </div>
                        <Badge color={item.status === 'queued' ? 'amber' : item.status === 'synced' ? 'green' : 'gray'}>{item.status}</Badge>
                      </div>
                      <p style={{ margin: '10px 0 0', color: '#6b7280', fontSize: 13 }}>{item.age_years} yrs · {item.sex} · {item.phone ?? 'No phone'}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card style={{ padding: 24 }}>
              <h3 style={{ marginTop: 0 }}>Sync queue</h3>
              {outreach.syncQueue.length === 0 ? (
                <p style={{ color: '#6b7280' }}>All queued items are synced.</p>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {outreach.syncQueue.slice(0, 6).map((item) => (
                    <div key={item.id} style={{ padding: 14, borderRadius: 14, border: '1px solid #e5e7eb', background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{item.entity}</div>
                        <Badge color={item.status === 'failed' ? 'red' : item.status === 'queued' ? 'amber' : 'green'}>{item.status}</Badge>
                      </div>
                      {item.error && <p style={{ margin: '8px 0 0', color: '#dc2626', fontSize: 13 }}>{item.error}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  )
}
