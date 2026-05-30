import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { Button, Card } from '../components/ui'
import { supabase } from '../lib/supabase'
import { verifyOutreachOtp, resendOutreachOtp } from '../lib/outreachApi'
import { OUTREACH_PATH, OUTREACH_SIGNUP_PATH, OUTREACH_LOGIN_PATH } from '../lib/outreachRoutes'

type OtpContext = {
  otpId: string
  maskedEmail: string
  expiresAt: string
  expiresInMinutes: number
  displayName: string
}

function loadContext(): OtpContext | null {
  try {
    const raw = sessionStorage.getItem('hid_outreach_otp')
    if (!raw) return null
    return JSON.parse(raw) as OtpContext
  } catch {
    return null
  }
}

function useCountdown(expiresAt: string | null) {
  const [secondsLeft, setSecondsLeft] = useState(() => {
    if (!expiresAt) return 0
    return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000))
  })

  useEffect(() => {
    if (!expiresAt) return
    const interval = setInterval(() => {
      const left = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000))
      setSecondsLeft(left)
    }, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  return { secondsLeft, label: `${mins}:${secs.toString().padStart(2, '0')}` }
}

export default function OutreachVerify() {
  const navigate = useNavigate()
  const [ctx, setCtx] = useState<OtpContext | null>(loadContext)
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const { secondsLeft, label: timeLabel } = useCountdown(ctx?.expiresAt ?? null)

  useEffect(() => {
    if (!ctx) {
      navigate(OUTREACH_SIGNUP_PATH, { replace: true })
    }
  }, [ctx, navigate])

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(c => Math.max(0, c - 1)), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const code = digits.join('')
  const isComplete = code.length === 6

  function handleDigitChange(index: number, value: string) {
    const cleaned = value.replace(/\D/g, '').slice(0, 1)
    const next = [...digits]
    next[index] = cleaned
    setDigits(next)
    setError(null)
    if (cleaned && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus()
    if (e.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus()
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    const next = Array(6).fill('')
    pasted.split('').forEach((ch, i) => { next[i] = ch })
    setDigits(next)
    setError(null)
    inputRefs.current[Math.min(pasted.length, 5)]?.focus()
  }

  async function handleVerify(e?: React.FormEvent) {
    e?.preventDefault()
    if (!isComplete || !ctx) return
    setError(null)
    setSubmitting(true)

    try {
      const result = await verifyOutreachOtp(ctx.otpId, code)

      // Set the session in the Supabase client
      await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      })

      sessionStorage.removeItem('hid_outreach_otp')
      setSuccess(true)

      setTimeout(() => navigate(OUTREACH_PATH, { replace: true }), 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed. Please try again.')
      setDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResend() {
    if (!ctx || resendCooldown > 0 || resending) return
    setResending(true)
    setError(null)
    try {
      const result = await resendOutreachOtp(ctx.otpId)
      setCtx(prev => prev ? { ...prev, expiresAt: result.expiresAt } : prev)
      // Update stored context
      const stored = loadContext()
      if (stored) {
        sessionStorage.setItem('hid_outreach_otp', JSON.stringify({ ...stored, expiresAt: result.expiresAt }))
      }
      setDigits(['', '', '', '', '', ''])
      setResendCooldown(60)
      inputRefs.current[0]?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the code. Please try again.')
    } finally {
      setResending(false)
    }
  }

  // Auto-submit when all 6 digits filled
  useEffect(() => {
    if (isComplete && !submitting && !success) {
      void handleVerify()
    }
  }, [isComplete])

  if (!ctx) return null

  const expired = secondsLeft === 0

  return (
    <Layout title="Outreach" subtitle="Verify your email">
      <div style={{ maxWidth: 440, margin: '0 auto' }}>
        <Card style={{ padding: 32 }}>
          {success ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
              <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Verified!</h2>
              <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>Taking you to your workspace…</p>
            </div>
          ) : (
            <>
              <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Check your email</h2>
              <p style={{ margin: '0 0 4px', color: '#374151', fontSize: 14 }}>
                We sent a 6-digit code to <strong>{ctx.maskedEmail}</strong>.
              </p>
              <p style={{ margin: '0 0 28px', color: '#6b7280', fontSize: 13 }}>
                Enter it below to verify your identity and complete your account setup.
              </p>

              <form onSubmit={handleVerify}>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 24 }} onPaste={handlePaste}>
                  {digits.map((d, i) => (
                    <input
                      key={i}
                      ref={el => { inputRefs.current[i] = el }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={d}
                      onChange={e => handleDigitChange(i, e.target.value)}
                      onKeyDown={e => handleKeyDown(i, e)}
                      disabled={submitting || expired}
                      style={{
                        width: 48, height: 56, textAlign: 'center', fontSize: 24, fontWeight: 700,
                        border: `2px solid ${error ? '#fca5a5' : d ? '#1a6fd4' : '#e5e7eb'}`,
                        borderRadius: 10, outline: 'none', fontFamily: 'monospace',
                        background: expired ? '#f9fafb' : '#fff', color: '#111827',
                        transition: 'border-color 0.15s',
                      }}
                    />
                  ))}
                </div>

                {error && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                    <p style={{ margin: 0, color: '#dc2626', fontSize: 13, lineHeight: 1.5 }}>{error}</p>
                  </div>
                )}

                {expired ? (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                    <p style={{ margin: 0, color: '#92400e', fontSize: 13 }}>This code has expired. Request a new one below.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <span style={{ fontSize: 13, color: '#6b7280' }}>Expires in <strong style={{ color: secondsLeft < 60 ? '#dc2626' : '#111827' }}>{timeLabel}</strong></span>
                    <span style={{ fontSize: 13, color: '#6b7280' }}>
                      {isComplete ? 'Verifying…' : `${code.length}/6 digits`}
                    </span>
                  </div>
                )}

                {!expired && (
                  <Button type="submit" variant="primary" loading={submitting} disabled={!isComplete} style={{ width: '100%', marginBottom: 12 }}>
                    {submitting ? 'Verifying…' : 'Verify email'}
                  </Button>
                )}
              </form>

              <div style={{ textAlign: 'center' }}>
                {resendCooldown > 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>Resend available in {resendCooldown}s</p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resending}
                    style={{ background: 'none', border: 'none', color: '#1a6fd4', fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 0 }}
                  >
                    {resending ? 'Sending…' : "Didn't receive it? Resend code"}
                  </button>
                )}
              </div>
            </>
          )}
        </Card>

        <p style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: '#9ca3af' }}>
          <Link to={OUTREACH_SIGNUP_PATH} style={{ color: '#6b7280' }}>Back to sign up</Link>
          {' · '}
          <Link to={OUTREACH_LOGIN_PATH} style={{ color: '#6b7280' }}>Sign in</Link>
        </p>
      </div>
    </Layout>
  )
}
