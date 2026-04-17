import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthShell } from '../../components/AuthShell'
import { OtpInputs } from '../../components/OtpInputs'
import { Button, Input, showToast } from '../../components/ui'
import { clearAllPortalSessions, signOutAndClearSessions } from '../../lib/auth'
import { ADMIN_LOGIN_PATH, ADMIN_OVERVIEW_PATH } from '../../lib/adminRoutes'
import { startAdminPasswordResetOtp, updateCurrentUserPassword, verifyAdminPasswordResetOtp } from '../../lib/hidApi'
import { supabase } from '../../lib/supabase'
import { isStrongPassword, PASSWORD_REQUIREMENTS_TEXT } from '../../lib/utils'

async function getCurrentAppRole() {
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) return null

  const { data: profile, error } = await supabase
    .from('hid_user_profiles')
    .select('app_role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (error) {
    throw error
  }

  const role = (profile as { app_role?: unknown } | null)?.app_role
  return typeof role === 'string' ? role : null
}

export default function AdminLogin() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'login' | 'forgot' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const [resetPassword, setResetPassword] = useState('')
  const [confirmResetPassword, setConfirmResetPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const canSubmitReset = isStrongPassword(resetPassword) && resetPassword === confirmResetPassword

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const role = await getCurrentAppRole()
        if (active && role === 'platform_admin') {
          navigate(ADMIN_OVERVIEW_PATH, { replace: true })
        }
      } catch {
        // Best effort only. Manual sign-in remains available.
      }
    })()

    return () => { active = false }
  }, [navigate])

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') {
        setStep('reset')
      }
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  async function sendResetLink() {
    if (!email.trim()) {
      showToast('Enter your admin email address first.', 'error')
      return
    }

    setLoading(true)
    try {
      await startAdminPasswordResetOtp(email)
      setOtp('')
      setOtpSent(true)
      setOtpVerified(false)
      showToast('We sent a 6-digit verification code to your email. Enter it here to continue.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send a verification code right now.'
      showToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function verifyResetOtp(nextCode = otp) {
    if (nextCode.trim().length !== 6 || !email.trim()) {
      showToast('Enter the full 6-digit verification code first.', 'error')
      return
    }

    setLoading(true)
    try {
      await verifyAdminPasswordResetOtp(email, nextCode.trim())
      setOtpVerified(true)
      setStep('reset')
      showToast('Verification complete. Enter your new password.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The verification code is not correct.'
      showToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function submitPasswordReset() {
    if (!canSubmitReset) {
      showToast('Enter a strong password and confirm it.', 'error')
      return
    }

    setLoading(true)
    try {
      await updateCurrentUserPassword(resetPassword)
      await signOutAndClearSessions()
      showToast('Password updated. You can now sign in.', 'success')
      setOtp('')
      setOtpSent(false)
      setOtpVerified(false)
      setResetPassword('')
      setConfirmResetPassword('')
      setStep('login')
      navigate(ADMIN_LOGIN_PATH, { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update your password.'
      showToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function submit() {
    if (!email.trim() || !password) {
      showToast('Enter your admin email address and password.', 'error')
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })

      if (error) {
        throw error
      }

      const role = await getCurrentAppRole()
      if (role !== 'platform_admin') {
        await supabase.auth.signOut().catch(() => undefined)
        clearAllPortalSessions()
        showToast('Admin access is limited to platform admins.', 'error')
        return
      }

      clearAllPortalSessions()
      showToast('Admin sign-in successful.', 'success')
      navigate(ADMIN_OVERVIEW_PATH, { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in right now.'
      showToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'forgot') {
    return (
      <AuthShell title="Reset Admin Password" providerLink={false} mode="forgot">
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.6 }}>
            {!otpSent
              ? 'Enter the platform admin email and we will send a verification code if the account is eligible.'
              : `We sent a 6-digit code to ${email || 'your email address'}.`}
          </div>
          {!otpSent ? (
            <>
              <Input
                label="Admin Email"
                type="email"
                placeholder="support@healthidentitydirectory.com"
                value={email}
                onChange={event => setEmail(event.target.value)}
                autoComplete="email"
              />
              <Button loading={loading} onClick={() => void sendResetLink()} fullWidth>
                Send OTP
              </Button>
            </>
          ) : (
            <>
              <OtpInputs value={otp} onChange={setOtp} onComplete={verifyResetOtp} />
              <Button loading={loading} onClick={() => void verifyResetOtp()} fullWidth>
                Verify code
              </Button>
              <button
                onClick={() => void sendResetLink()}
                style={{ border: 'none', background: 'none', color: '#1f8cff', fontSize: 12, cursor: 'pointer', justifySelf: 'start', padding: 0 }}
              >
                Send code again
              </button>
            </>
          )}
          <button
            onClick={() => {
              setStep('login')
              setOtp('')
              setOtpSent(false)
              setOtpVerified(false)
            }}
            style={{ border: 'none', background: 'none', color: '#1f8cff', fontSize: 12, cursor: 'pointer', justifySelf: 'start', padding: 0 }}
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    )
  }

  if (step === 'reset') {
    return (
      <AuthShell title="Choose a New Password" providerLink={false} mode="forgot">
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.6 }}>
            Set a new password for your admin account, then sign in again from this page.
          </div>
          <Input
            label="New Password"
            type="password"
            placeholder="Enter a strong password"
            value={resetPassword}
            onChange={event => setResetPassword(event.target.value)}
            autoComplete="new-password"
          />
          <div style={{ color: '#6b7280', fontSize: 11, lineHeight: 1.6 }}>
            {PASSWORD_REQUIREMENTS_TEXT}
          </div>
          <Input
            label="Confirm Password"
            type="password"
            placeholder="Confirm your new password"
            value={confirmResetPassword}
            onChange={event => setConfirmResetPassword(event.target.value)}
            autoComplete="new-password"
          />
          <Button loading={loading} disabled={!canSubmitReset} onClick={() => void submitPasswordReset()} fullWidth>
            Update password
          </Button>
          {!otpVerified && (
            <button
              onClick={() => {
                setStep('forgot')
              }}
              style={{ border: 'none', background: 'none', color: '#1f8cff', fontSize: 12, cursor: 'pointer', justifySelf: 'start', padding: 0 }}
            >
              Back
            </button>
          )}
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Admin Sign In" providerLink={false} mode="forgot">
      <div style={{ display: 'grid', gap: 18 }}>
        <div style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.6 }}>
          Sign in with your platform admin email and password to open the HID admin dashboard.
        </div>
        <Input
          label="Admin Email"
          type="email"
          placeholder="support@healthidentitydirectory.com"
          value={email}
          onChange={event => setEmail(event.target.value)}
          autoComplete="email"
        />
        <Input
          label="Password"
          type="password"
          placeholder="Enter your password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          autoComplete="current-password"
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <Button loading={loading} onClick={() => void submit()} fullWidth>
          Sign In
        </Button>
        <button
          onClick={() => setStep('forgot')}
          style={{ border: 'none', background: 'none', color: '#1f8cff', fontSize: 12, cursor: 'pointer', justifySelf: 'start', padding: 0 }}
        >
          Forgot password?
        </button>
        <button
          onClick={() => navigate('/', { replace: true })}
          style={{ border: 'none', background: 'none', color: '#1f8cff', fontSize: 12, cursor: 'pointer', justifySelf: 'start', padding: 0 }}
        >
          Back to home
        </button>
      </div>
    </AuthShell>
  )
}
