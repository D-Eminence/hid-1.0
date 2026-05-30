import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { Button, Card, Input } from '../components/ui'
import { supabase } from '../lib/supabase'
import { createOutreachCampaign, createOutreachWorker } from '../lib/outreachApi'
import { OUTREACH_PATH, OUTREACH_LOGIN_PATH, OUTREACH_JOIN_PATH } from '../lib/outreachRoutes'

type Step = 'campaign' | 'account' | 'confirm-email' | 'done'

export default function OutreachSignup() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('campaign')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [campaign, setCampaign] = useState({ name: '', org: '', location: '', starts_at: '' })
  const [account, setAccount] = useState({ display_name: '', email: '', password: '' })

  function setCampaignField(field: keyof typeof campaign) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setCampaign((prev) => ({ ...prev, [field]: e.target.value }))
  }

  function setAccountField(field: keyof typeof account) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setAccount((prev) => ({ ...prev, [field]: e.target.value }))
  }

  function validateCampaign() {
    if (!campaign.name.trim()) return 'Campaign name is required.'
    if (!campaign.org.trim()) return 'Organization name is required.'
    if (!campaign.location.trim()) return 'Location is required.'
    if (!campaign.starts_at) return 'Start date is required.'
    return null
  }

  function validateAccount() {
    if (!account.display_name.trim()) return 'Your name is required.'
    if (!account.email.trim()) return 'Email is required.'
    if (account.password.length < 8) return 'Password must be at least 8 characters.'
    return null
  }

  function handleCampaignNext(e: React.FormEvent) {
    e.preventDefault()
    const err = validateCampaign()
    if (err) { setError(err); return }
    setError(null)
    setStep('account')
  }

  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validateAccount()
    if (err) { setError(err); return }
    setError(null)
    setSubmitting(true)

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: account.email.trim(),
        password: account.password,
        options: { data: { display_name: account.display_name.trim() } },
      })
      if (signUpError) throw new Error(signUpError.message)

      const userId = data.session?.user.id ?? data.user?.id
      if (!userId) {
        setStep('confirm-email')
        return
      }

      const newCampaign = await createOutreachCampaign(
        campaign.name.trim(),
        campaign.org.trim(),
        campaign.location.trim(),
        new Date(campaign.starts_at).toISOString()
      )
      await createOutreachWorker(userId, newCampaign.id, account.display_name.trim(), 'admin')

      navigate(OUTREACH_PATH, { replace: true })
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Signup failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'confirm-email') {
    return (
      <Layout title="Outreach" subtitle="Almost there">
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <Card style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📧</div>
            <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>Check your email</h2>
            <p style={{ color: '#6b7280', marginBottom: 24, lineHeight: 1.6 }}>
              We sent a confirmation link to <strong>{account.email}</strong>.
              Click it, then sign in below — your campaign workspace will be ready.
            </p>
            <Button variant="primary" onClick={() => navigate(OUTREACH_LOGIN_PATH)}>
              Go to sign in
            </Button>
          </Card>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title="Outreach" subtitle="Create your campaign workspace">
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {(['campaign', 'account'] as const).map((s, i) => (
            <div key={s} style={{ flex: 1, height: 4, borderRadius: 4, background: step === s || (s === 'campaign' && step === 'account') ? '#1a6fd4' : '#e5e7eb' }} />
          ))}
        </div>

        {step === 'campaign' && (
          <Card style={{ padding: 32 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Campaign details</h2>
            <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>Tell us about your outreach campaign.</p>
            <form onSubmit={handleCampaignNext} style={{ display: 'grid', gap: 16 }}>
              <Input label="Organization name" placeholder="e.g. Lagos State Health Service" value={campaign.org} onChange={setCampaignField('org')} />
              <Input label="Campaign name" placeholder="e.g. Ward 3 Immunization Drive" value={campaign.name} onChange={setCampaignField('name')} />
              <Input label="Location" placeholder="e.g. Agege, Lagos" value={campaign.location} onChange={setCampaignField('location')} />
              <Input label="Start date" type="date" value={campaign.starts_at} onChange={setCampaignField('starts_at')} />
              {error && <p style={{ margin: 0, color: '#dc2626', fontSize: 13 }}>{error}</p>}
              <Button type="submit" variant="primary">Continue</Button>
            </form>
            <p style={{ marginTop: 20, fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
              Have an invite code?{' '}
              <Link to={OUTREACH_JOIN_PATH} style={{ color: '#1a6fd4', fontWeight: 600 }}>Join a campaign</Link>
              {' · '}
              <Link to={OUTREACH_LOGIN_PATH} style={{ color: '#1a6fd4', fontWeight: 600 }}>Sign in</Link>
            </p>
          </Card>
        )}

        {step === 'account' && (
          <Card style={{ padding: 32 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Your account</h2>
            <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>You'll be the admin for <strong>{campaign.name}</strong>.</p>
            <form onSubmit={handleAccountSubmit} style={{ display: 'grid', gap: 16 }}>
              <Input label="Your full name" placeholder="e.g. Amina Bello" value={account.display_name} onChange={setAccountField('display_name')} />
              <Input label="Email" type="email" placeholder="you@example.com" value={account.email} onChange={setAccountField('email')} />
              <Input label="Password" type="password" placeholder="At least 8 characters" value={account.password} onChange={setAccountField('password')} />
              {error && <p style={{ margin: 0, color: '#dc2626', fontSize: 13 }}>{error}</p>}
              <div style={{ display: 'flex', gap: 10 }}>
                <Button type="button" variant="secondary" onClick={() => { setError(null); setStep('campaign') }}>Back</Button>
                <Button type="submit" variant="primary" loading={submitting} style={{ flex: 1 }}>Create workspace</Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </Layout>
  )
}
