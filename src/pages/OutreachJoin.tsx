import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { Button, Card, Input, Spinner } from '../components/ui'
import { supabase } from '../lib/supabase'
import { fetchInviteByCode, fetchCampaignById, joinWithInviteCode } from '../lib/outreachApi'
import { OUTREACH_PATH, OUTREACH_LOGIN_PATH, OUTREACH_SIGNUP_PATH } from '../lib/outreachRoutes'
import type { OutreachCampaign, OutreachInvite } from '../types/outreach'

// OUTREACH_LOGIN_PATH now points to /outreach/login (dedicated outreach auth)

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px' }}>
      <span style={{ fontSize: 15, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>⚠</span>
      <p style={{ margin: 0, color: '#b91c1c', fontSize: 13, lineHeight: 1.55 }}>{message}</p>
    </div>
  )
}

type Step = 'code' | 'form'

export default function OutreachJoin() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [step, setStep] = useState<Step>('code')
  const [submitting, setSubmitting] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [code, setCode] = useState(() => (searchParams.get('code') ?? '').toUpperCase())
  const [invite, setInvite] = useState<OutreachInvite | null>(null)
  const [campaign, setCampaign] = useState<OutreachCampaign | null>(null)

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Auto-lookup if code in URL
  useEffect(() => {
    const urlCode = searchParams.get('code')
    if (urlCode) void lookupCode(urlCode)
  }, [])

  async function lookupCode(rawCode = code) {
    if (!rawCode.trim()) { setError('Enter your invite code.'); return }
    setLookingUp(true)
    setError(null)
    try {
      const found = await fetchInviteByCode(rawCode.trim())
      if (!found) { setError('This invite code is not valid. Check the link and try again.'); return }
      if (found.use_count >= found.max_uses) { setError('This invite link has reached its limit. Ask your campaign admin for a new one.'); return }
      if (found.expires_at && new Date(found.expires_at) < new Date()) { setError('This invite link has expired. Ask your campaign admin for a new one.'); return }

      const camp = await fetchCampaignById(found.campaign_id)
      setInvite(found)
      setCampaign(camp)
      setStep('form')
    } catch (err) {
      setError("We couldn't validate that invite code right now. Please check your connection and try again.")
    } finally {
      setLookingUp(false)
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) { setError('Your name is required.'); return }
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) { setError('Please enter a valid email address.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (!invite) return
    setError(null)
    setSubmitting(true)

    try {
      const result = await joinWithInviteCode(
        invite.code,
        email.trim().toLowerCase(),
        password,
        displayName.trim()
      )

      // Set the live session directly — no email confirmation needed
      await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      })

      navigate(OUTREACH_PATH, { replace: true })
    } catch (err) {
      const raw = err instanceof Error ? err.message : ''
      const safe = raw && !raw.toLowerCase().includes('supabase') && !raw.toLowerCase().includes('fetch')
        ? raw
        : 'Something went wrong joining the campaign. Please try again.'
      setError(safe)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Layout title="Outreach" subtitle="Join a campaign">
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'grid', gap: 16 }}>

        {step === 'code' && (
          <Card style={{ padding: 32 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Enter your invite code</h2>
            <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>
              Your campaign admin shared a link or code with you. Enter it below to join.
            </p>
            <div style={{ display: 'grid', gap: 16 }}>
              <Input
                label="Invite code"
                placeholder="e.g. ABCD-EFGH"
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); setError(null) }}
              />
              {error && <ErrorBox message={error} />}
              <Button variant="primary" onClick={() => lookupCode()} loading={lookingUp}>Continue</Button>
            </div>
            <p style={{ marginTop: 20, fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
              Starting a new campaign?{' '}
              <Link to={OUTREACH_SIGNUP_PATH} style={{ color: '#1a6fd4', fontWeight: 600 }}>Create workspace</Link>
              {' · '}
              <Link to={OUTREACH_LOGIN_PATH} style={{ color: '#1a6fd4', fontWeight: 600 }}>Sign in</Link>
            </p>
          </Card>
        )}

        {step === 'form' && campaign && invite && (
          <>
            <div style={{ background: '#f0f7ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '16px 20px' }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: '#1a6fd4', textTransform: 'uppercase', letterSpacing: '0.1em' }}>You're joining</p>
              <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 16 }}>{campaign.name}</p>
              <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
                {campaign.org} · {campaign.location}
                <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 20, background: '#e0f2fe', color: '#0369a1', fontSize: 11, fontWeight: 600 }}>
                  {invite.role}
                </span>
              </p>
            </div>

            <Card style={{ padding: 32 }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Your details</h2>
              <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>
                Create your account to access the campaign workspace.
              </p>
              <form onSubmit={handleJoin} style={{ display: 'grid', gap: 16 }}>
                <Input
                  label="Your full name"
                  placeholder="e.g. Chidi Okafor"
                  value={displayName}
                  onChange={e => { setDisplayName(e.target.value); setError(null) }}
                />
                <Input
                  label="Email address"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(null) }}
                />
                <Input
                  label="Password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(null) }}
                />
                {error && <ErrorBox message={error} />}
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => { setError(null); setStep('code') }}
                  >
                    Back
                  </Button>
                  <Button type="submit" variant="primary" loading={submitting} style={{ flex: 1 }}>
                    Join campaign
                  </Button>
                </div>
              </form>
            </Card>
          </>
        )}
      </div>
    </Layout>
  )
}
