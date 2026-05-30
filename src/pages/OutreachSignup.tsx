import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { Button, Card, Input } from '../components/ui'
import { signupOutreachAdmin } from '../lib/outreachApi'
import { OUTREACH_LOGIN_PATH, OUTREACH_JOIN_PATH, OUTREACH_VERIFY_PATH } from '../lib/outreachRoutes'

type Step = 'campaign' | 'account'

export default function OutreachSignup() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('campaign')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [campaign, setCampaign] = useState({ name: '', org: '', location: '', starts_at: '' })
  const [account, setAccount] = useState({ display_name: '', email: '', password: '' })

  function setC(field: keyof typeof campaign) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setCampaign(p => ({ ...p, [field]: e.target.value }))
  }
  function setA(field: keyof typeof account) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setAccount(p => ({ ...p, [field]: e.target.value }))
  }

  function handleCampaignNext(e: React.FormEvent) {
    e.preventDefault()
    if (!campaign.name.trim()) { setError('Campaign name is required.'); return }
    if (!campaign.org.trim()) { setError('Organization name is required.'); return }
    if (!campaign.location.trim()) { setError('Location is required.'); return }
    if (!campaign.starts_at) { setError('Start date is required.'); return }
    setError(null)
    setStep('account')
  }

  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!account.display_name.trim()) { setError('Your name is required.'); return }
    if (!account.email.trim() || !/\S+@\S+\.\S+/.test(account.email)) { setError('Please enter a valid email address.'); return }
    if (account.password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setError(null)
    setSubmitting(true)

    try {
      const result = await signupOutreachAdmin({
        email: account.email.trim(),
        password: account.password,
        displayName: account.display_name.trim(),
        campaignName: campaign.name.trim(),
        org: campaign.org.trim(),
        location: campaign.location.trim(),
        startsAt: new Date(campaign.starts_at).toISOString(),
      })

      // Store OTP context in sessionStorage for the verify page
      sessionStorage.setItem('hid_outreach_otp', JSON.stringify({
        otpId: result.otpId,
        maskedEmail: result.maskedEmail,
        expiresAt: result.expiresAt,
        expiresInMinutes: result.expiresInMinutes,
        displayName: account.display_name.trim(),
      }))

      navigate(OUTREACH_VERIFY_PATH, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Layout title="Outreach" subtitle="Create your campaign workspace">
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {(['campaign', 'account'] as const).map(s => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 4, background: s === 'campaign' || step === 'account' ? '#1a6fd4' : '#e5e7eb', transition: 'background 0.2s' }} />
          ))}
        </div>

        {step === 'campaign' && (
          <Card style={{ padding: 32 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Campaign details</h2>
            <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>Tell us about the outreach campaign you're running.</p>
            <form onSubmit={handleCampaignNext} style={{ display: 'grid', gap: 16 }}>
              <Input label="Organization name" placeholder="e.g. Lagos State Health Service" value={campaign.org} onChange={setC('org')} />
              <Input label="Campaign name" placeholder="e.g. Ward 3 Immunization Drive" value={campaign.name} onChange={setC('name')} />
              <Input label="Location" placeholder="e.g. Agege, Lagos" value={campaign.location} onChange={setC('location')} />
              <Input label="Start date" type="date" value={campaign.starts_at} onChange={setC('starts_at')} />
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
            <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Your account</h2>
            <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>You'll be the admin for <strong>{campaign.name}</strong>. We'll send a verification code to your email.</p>
            <form onSubmit={handleAccountSubmit} style={{ display: 'grid', gap: 16 }}>
              <Input label="Your full name" placeholder="e.g. Amina Bello" value={account.display_name} onChange={setA('display_name')} />
              <Input label="Email address" type="email" placeholder="you@example.com" value={account.email} onChange={setA('email')} />
              <Input label="Password" type="password" placeholder="At least 8 characters" value={account.password} onChange={setA('password')} />
              {error && <p style={{ margin: 0, color: '#dc2626', fontSize: 13 }}>{error}</p>}
              <div style={{ display: 'flex', gap: 10 }}>
                <Button type="button" variant="secondary" onClick={() => { setError(null); setStep('campaign') }}>Back</Button>
                <Button type="submit" variant="primary" loading={submitting} style={{ flex: 1 }}>Send verification code</Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </Layout>
  )
}
