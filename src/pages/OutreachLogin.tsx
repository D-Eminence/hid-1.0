import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { Button, Card, Input } from '../components/ui'
import { loginOutreachWorker } from '../lib/outreachApi'
import { OUTREACH_PATH, OUTREACH_SIGNUP_PATH, OUTREACH_JOIN_PATH } from '../lib/outreachRoutes'

export default function OutreachLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Please enter your email address.'); return }
    if (!password) { setError('Please enter your password.'); return }
    setError(null)
    setSubmitting(true)

    try {
      await loginOutreachWorker(email.trim().toLowerCase(), password)
      navigate(OUTREACH_PATH, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please check your details and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Layout title="Outreach" subtitle="Sign in to your workspace">
      <div style={{ maxWidth: 420, margin: '0 auto' }}>
        <Card style={{ padding: 32 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Sign in</h2>
          <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>Access your outreach campaign workspace.</p>

          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
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
              placeholder="Your password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null) }}
            />

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px' }}>
                <p style={{ margin: 0, color: '#dc2626', fontSize: 13, lineHeight: 1.5 }}>{error}</p>
              </div>
            )}

            <Button type="submit" variant="primary" loading={submitting}>Sign in</Button>
          </form>
        </Card>

        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: '#6b7280', display: 'grid', gap: 8 }}>
          <p style={{ margin: 0 }}>
            New to outreach?{' '}
            <Link to={OUTREACH_SIGNUP_PATH} style={{ color: '#1a6fd4', fontWeight: 600 }}>Create a campaign workspace</Link>
          </p>
          <p style={{ margin: 0 }}>
            Have an invite code?{' '}
            <Link to={OUTREACH_JOIN_PATH} style={{ color: '#1a6fd4', fontWeight: 600 }}>Join a campaign</Link>
          </p>
        </div>
      </div>
    </Layout>
  )
}
