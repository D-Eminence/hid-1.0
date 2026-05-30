import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { Button, Card, Input, Spinner } from '../components/ui'
import { supabase } from '../lib/supabase'
import {
  createOutreachWorker,
  fetchCampaignById,
  fetchInviteByCode,
  incrementInviteUseCount,
} from '../lib/outreachApi'
import { OUTREACH_PATH, OUTREACH_LOGIN_PATH, OUTREACH_SIGNUP_PATH } from '../lib/outreachRoutes'
// OUTREACH_LOGIN_PATH now points to /outreach/login (dedicated outreach auth)
import type { OutreachCampaign, OutreachInvite } from '../types/outreach'

type Step = 'code' | 'preview' | 'account' | 'confirm-email'

export default function OutreachJoin() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [step, setStep] = useState<Step>('code')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lookingUp, setLookingUp] = useState(false)

  const [code, setCode] = useState(() => searchParams.get('code') ?? '')
  const [invite, setInvite] = useState<OutreachInvite | null>(null)
  const [campaign, setCampaign] = useState<OutreachCampaign | null>(null)
  const [account, setAccount] = useState({ display_name: '', email: '', password: '' })

  // Auto-lookup if code came from URL
  useEffect(() => {
    const urlCode = searchParams.get('code')
    if (urlCode) void lookupCode(urlCode)
  }, [])

  async function lookupCode(rawCode = code) {
    if (!rawCode.trim()) { setError('Enter an invite code.'); return }
    setLookingUp(true)
    setError(null)
    try {
      const found = await fetchInviteByCode(rawCode.trim())
      if (!found) { setError('Invalid invite code. Check the code and try again.'); return }
      if (found.use_count >= found.max_uses) { setError('This invite link has reached its limit. Ask your admin for a new one.'); return }
      if (found.expires_at && new Date(found.expires_at) < new Date()) { setError('This invite link has expired. Ask your admin for a new one.'); return }

      const campaignData = await fetchCampaignById(found.campaign_id)
      setInvite(found)
      setCampaign(campaignData)
      setStep('preview')
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Could not validate invite code.')
    } finally {
      setLookingUp(false)
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!account.display_name.trim()) { setError('Your name is required.'); return }
    if (!account.email.trim()) { setError('Email is required.'); return }
    if (account.password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (!invite || !campaign) return
    setError(null)
    setSubmitting(true)

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: account.email.trim(),
        password: account.password,
        options: { data: { display_name: account.display_name.trim() } },
      })
      if (signUpError) throw new Error(signUpError.message)

      const userId = data.session?.user.id
      if (!userId) {
        setStep('confirm-email')
        return
      }

      await createOutreachWorker(userId, campaign.id, account.display_name.trim(), invite.role)
      await incrementInviteUseCount(invite.id)
      navigate(OUTREACH_PATH, { replace: true })
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Could not join campaign. Please try again.')
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
              Click it, then sign in — you'll be added to <strong>{campaign?.name}</strong>.
            </p>
            <Button variant="primary" onClick={() => navigate(OUTREACH_LOGIN_PATH)}>Go to sign in</Button>
          </Card>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title="Outreach" subtitle="Join a campaign">
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'grid', gap: 16 }}>

        {step === 'code' && (
          <Card style={{ padding: 32 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Enter your invite code</h2>
            <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>Ask your campaign admin for the code.</p>
            <div style={{ display: 'grid', gap: 16 }}>
              <Input
                label="Invite code"
                placeholder="e.g. ABCD-EFGH"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              {error && <p style={{ margin: 0, color: '#dc2626', fontSize: 13 }}>{error}</p>}
              <Button variant="primary" onClick={() => lookupCode()} loading={lookingUp}>
                Continue
              </Button>
            </div>
            <p style={{ marginTop: 20, fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
              Starting a new campaign?{' '}
              <Link to={OUTREACH_SIGNUP_PATH} style={{ color: '#1a6fd4', fontWeight: 600 }}>Create workspace</Link>
              {' · '}
              <Link to={OUTREACH_LOGIN_PATH} style={{ color: '#1a6fd4', fontWeight: 600 }}>Sign in</Link>
            </p>
          </Card>
        )}

        {(step === 'preview' || step === 'account') && campaign && invite && (
          <>
            <Card style={{ padding: 20, background: '#f0f7ff', border: '1px solid #bfdbfe' }}>
              <p style={{ margin: '0 0 4px', fontSize: 12, color: '#1a6fd4', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>You're joining</p>
              <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 16 }}>{campaign.name}</p>
              <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>{campaign.org} · {campaign.location} · Role: {invite.role}</p>
            </Card>

            <Card style={{ padding: 32 }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Create your account</h2>
              <form onSubmit={handleJoin} style={{ display: 'grid', gap: 16 }}>
                <Input label="Your full name" placeholder="e.g. Chidi Okafor" value={account.display_name} onChange={(e) => setAccount((p) => ({ ...p, display_name: e.target.value }))} />
                <Input label="Email" type="email" placeholder="you@example.com" value={account.email} onChange={(e) => setAccount((p) => ({ ...p, email: e.target.value }))} />
                <Input label="Password" type="password" placeholder="At least 8 characters" value={account.password} onChange={(e) => setAccount((p) => ({ ...p, password: e.target.value }))} />
                {error && <p style={{ margin: 0, color: '#dc2626', fontSize: 13 }}>{error}</p>}
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button type="button" variant="secondary" onClick={() => { setError(null); setStep('code') }}>Back</Button>
                  <Button type="submit" variant="primary" loading={submitting} style={{ flex: 1 }}>Join campaign</Button>
                </div>
              </form>
            </Card>
          </>
        )}
      </div>
    </Layout>
  )
}
