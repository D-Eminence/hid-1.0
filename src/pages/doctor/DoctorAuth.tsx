import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthLegalConsent } from '../../components/AuthLegalConsent'
import { AuthShell } from '../../components/AuthShell'
import { OtpInputs } from '../../components/OtpInputs'
import { TurnstileWidget } from '../../components/TurnstileWidget'
import { Button, Input, Select, showToast } from '../../components/ui'
import { clearStaffSession, getStaffSession, setStaffSession, signOutAndClearSessions } from '../../lib/auth'
import { HOSPITAL_AUTH_PATH, HOSPITAL_DASHBOARD_PATH } from '../../lib/hospitalRoutes'
import {
  fetchMyStaffAccount,
  providerSignUp,
  providerSignIn,
  sendStaffVerificationEmail,
  sendStaffPasswordReset,
  updateCurrentUserPassword,
  verifyStaffPasswordResetOtp,
  verifyStaffSignupOtp,
} from '../../lib/hidApi'
import { trackEvent } from '../../lib/observabilityBridge'
import { preloadRoutesAfterDelay } from '../../lib/routePreload'
import { supabase } from '../../lib/supabase'
import { COUNTRIES, PASSWORD_REQUIREMENTS_TEXT, STATES_BY_COUNTRY, isStrongPassword, maskEmailAddress } from '../../lib/utils'

type DoctorStep = 'login' | 'signup' | 'verify' | 'forgot' | 'reset'
const TURNSTILE_ENABLED = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY)

function actionButtonStyle(active: boolean) {
  return { marginTop: 16, background: active ? '#1f8cff' : '#9aa6b2' }
}

function SegmentedTabs({ active, onChange }: { active: 'login' | 'signup'; onChange: (value: 'login' | 'signup') => void }) {
  return (
    <div style={{ background: '#f5f7fa', borderRadius: 999, padding: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
      {[
        { key: 'login', label: 'Sign In' },
        { key: 'signup', label: 'Sign Up' },
      ].map(item => (
        <button
          key={item.key}
          onClick={() => onChange(item.key as 'login' | 'signup')}
          style={{
            border: 'none',
            borderRadius: 999,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 600,
            background: active === item.key ? '#fff' : 'transparent',
            color: active === item.key ? '#111827' : '#9aa5b5',
            boxShadow: active === item.key ? '0 4px 12px rgba(17, 24, 39, 0.06)' : 'none',
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default function DoctorAuth() {
  const navigate = useNavigate()
  const existingSession = useMemo(() => getStaffSession(), [])
  const inRecoveryMode = typeof window !== 'undefined' && (window.location.hash.includes('type=recovery') || window.location.search.includes('type=recovery'))
  const [step, setStep] = useState<DoctorStep>(inRecoveryMode ? 'reset' : 'login')
  const [loading, setLoading] = useState(false)
  const [loginForm, setLoginForm] = useState({ hospitalName: '', email: '', password: '' })
  const [signupForm, setSignupForm] = useState({ hospitalName: '', email: '', state: '', country: '', password: '', confirmPassword: '' })
  const [forgot, setForgot] = useState({ email: '', otp: '' })
  const [forgotCodeSent, setForgotCodeSent] = useState(false)
  const [forgotOtpVerified, setForgotOtpVerified] = useState(false)
  const [resetPassword, setResetPassword] = useState('')
  const [confirmResetPassword, setConfirmResetPassword] = useState('')
  const [signupVerification, setSignupVerification] = useState({ email: '', password: '', code: '' })
  const [signupAccepted, setSignupAccepted] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)

  const canSubmitLogin = !!loginForm.hospitalName.trim() && !!loginForm.email.trim() && !!loginForm.password
  const canSubmitSignup =
    !!signupForm.hospitalName.trim() &&
    !!signupForm.email.trim() &&
    !!signupForm.state.trim() &&
    !!signupForm.country.trim() &&
    isStrongPassword(signupForm.password) &&
    signupForm.password === signupForm.confirmPassword &&
    signupAccepted
  const canSubmitReset = isStrongPassword(resetPassword) && resetPassword === confirmResetPassword
  const stateOptions = (signupForm.country ? STATES_BY_COUNTRY[signupForm.country] ?? [] : []).map(value => ({ value, label: value }))
  const showStateSelect = stateOptions.length > 0

  useEffect(() => {
    if (inRecoveryMode) return

    let active = true
    void (async () => {
      try {
        const staffAccount = await fetchMyStaffAccount()
        if (!active || !staffAccount) return
        setStaffSession({
          id: staffAccount.id,
          fullName: staffAccount.full_name,
          hospitalName: staffAccount.hospital_name,
          email: staffAccount.email,
          role: staffAccount.role,
        })
        navigate(HOSPITAL_DASHBOARD_PATH)
      } catch {
        if (!active) return
        clearStaffSession()
      }
    })()

    return () => { active = false }
  }, [existingSession, inRecoveryMode, navigate])

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

  useEffect(() => preloadRoutesAfterDelay(['doctorDashboard', 'doctorAccess', 'doctorHistory', 'doctorEmergency', 'doctorPatientRecords']), [])

  function requireCaptcha() {
    if (!TURNSTILE_ENABLED) return true
    if (captchaToken) return true
    showToast('Complete the security check before continuing.', 'error')
    return false
  }

  function resetCaptcha() {
    setCaptchaToken(null)
    setCaptchaResetKey(current => current + 1)
  }

  async function submitLogin() {
    if (!canSubmitLogin) {
      showToast('Enter your hospital name, email, and password', 'error')
      return
    }
    if (!requireCaptcha()) return

    setLoading(true)
    try {
      const staffAccount = await providerSignIn(loginForm.hospitalName, loginForm.email, loginForm.password, captchaToken)
      trackEvent('staff_signin_completed')
      setStaffSession({
        id: staffAccount.id,
        fullName: staffAccount.full_name,
        hospitalName: (staffAccount.hospital_name ?? loginForm.hospitalName.trim()) || null,
        email: staffAccount.email,
        role: staffAccount.role,
      })
      navigate(HOSPITAL_DASHBOARD_PATH)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid hospital credentials.'
      if (error instanceof Error && message.toLowerCase().includes('email not confirmed') && /\S+@\S+\.\S+/.test(loginForm.email.trim())) {
        await sendStaffVerificationEmail(loginForm.email.trim().toLowerCase(), captchaToken).catch(() => {})
        setSignupVerification({
          email: loginForm.email.trim().toLowerCase(),
          password: loginForm.password,
          code: '',
        })
        setStep('verify')
        showToast('Enter the 6-digit verification code we sent to your email to continue.', 'info')
        return
      }
      showToast(message, 'error')
    } finally {
      resetCaptcha()
      setLoading(false)
    }
  }

  async function submitHospitalSignup() {
    if (!signupAccepted) {
      showToast('You must agree to the Terms of Service and Privacy Policy before creating an account', 'error')
      return
    }
    if (!isStrongPassword(signupForm.password)) {
      showToast(PASSWORD_REQUIREMENTS_TEXT, 'error')
      return
    }
    if (signupForm.password !== signupForm.confirmPassword) {
      showToast('Passwords do not match', 'error')
      return
    }
    if (!requireCaptcha()) return

    setLoading(true)
    try {
      const result = await providerSignUp({
        captchaToken,
        country: signupForm.country,
        email: signupForm.email,
        hospitalName: signupForm.hospitalName,
        password: signupForm.password,
        state: signupForm.state,
      })

      if (!result.staffAccount) {
        trackEvent('hospital_signup_pending_verification')
        setSignupVerification({
          email: signupForm.email.trim().toLowerCase(),
          password: signupForm.password,
          code: '',
        })
        showToast('We sent a 6-digit verification code to your email. Enter it here to finish creating the hospital account.', 'success')
        setStep('verify')
        return
      }

      trackEvent('hospital_signup_completed')
      setStaffSession({
        id: result.staffAccount.id,
        fullName: result.staffAccount.full_name,
        hospitalName: result.staffAccount.hospital_name,
        email: result.staffAccount.email,
        role: result.staffAccount.role,
      })
      navigate(HOSPITAL_DASHBOARD_PATH)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create the hospital account.'
      showToast(message, 'error')
    } finally {
      resetCaptcha()
      setLoading(false)
    }
  }

  async function verifySignupCode(nextCode = signupVerification.code) {
    if (nextCode.trim().length !== 6 || !signupVerification.email || !signupVerification.password) {
      showToast('Enter the full 6-digit verification code first.', 'error')
      return
    }

    setLoading(true)
    try {
      const staffAccount = await verifyStaffSignupOtp(signupVerification.email, signupVerification.password, nextCode.trim())
      trackEvent('hospital_signup_completed')
      setStaffSession({
        id: staffAccount.id,
        fullName: staffAccount.full_name,
        hospitalName: staffAccount.hospital_name,
        email: staffAccount.email,
        role: staffAccount.role,
      })
      showToast('Email verified. Your hospital account is ready.', 'success')
      navigate(HOSPITAL_DASHBOARD_PATH)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The verification code is not correct.'
      showToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function resendSignupCode() {
    if (!signupVerification.email) {
      showToast('Start sign-up again before requesting a new verification code.', 'error')
      return
    }
    if (!requireCaptcha()) return

    setLoading(true)
    try {
      await sendStaffVerificationEmail(signupVerification.email, captchaToken)
      showToast('A new verification code has been sent to your email.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send another verification code right now.'
      showToast(message, 'error')
    } finally {
      resetCaptcha()
      setLoading(false)
    }
  }

  async function startForgotPassword() {
    if (!forgot.email.trim()) {
      showToast('Enter your email address first.', 'error')
      return
    }
    if (!requireCaptcha()) return

    setLoading(true)
    try {
      await sendStaffPasswordReset(forgot.email, `${window.location.origin}${HOSPITAL_AUTH_PATH}`, captchaToken)
      trackEvent('staff_password_reset_requested')
      setForgotCodeSent(true)
      setForgotOtpVerified(false)
      setForgot(current => ({ ...current, otp: '' }))
      showToast('We sent a 6-digit verification code to your email. Enter it here to continue.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send a verification code right now.'
      showToast(message, 'error')
    } finally {
      resetCaptcha()
      setLoading(false)
    }
  }

  async function verifyForgotCode(nextCode = forgot.otp) {
    if (nextCode.trim().length !== 6 || !forgot.email.trim()) {
      showToast('Enter the full 6-digit verification code first.', 'error')
      return
    }

    setLoading(true)
    try {
      await verifyStaffPasswordResetOtp(forgot.email, nextCode.trim())
      setForgotOtpVerified(true)
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
      trackEvent('staff_password_reset_completed')
      showToast('Password updated. You can now sign in.', 'success')
      setForgot({ email: '', otp: '' })
      setForgotCodeSent(false)
      setForgotOtpVerified(false)
      setResetPassword('')
      setConfirmResetPassword('')
      setStep('login')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update your password.'
      showToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'forgot') {
    return (
      <AuthShell mode="forgot">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 30, fontWeight: 700 }}>
              {!forgotCodeSent ? 'Reset your password' : !forgotOtpVerified ? 'Enter verification code' : 'Choose a new password'}
            </div>
            <p style={{ color: '#7d8797', marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
              {!forgotCodeSent
                ? 'Enter the email linked to your hospital account and we will send a verification code.'
                : !forgotOtpVerified
                ? `We sent a 6-digit code to ${maskEmailAddress(forgot.email) || 'your email address'}.`
                : 'Verification complete. Enter your new password below.'}
            </p>
          </div>
          {!forgotCodeSent ? (
            <>
              <Input placeholder="Email address" value={forgot.email} onChange={e => setForgot(current => ({ ...current, email: e.target.value }))} style={{ marginTop: 22 }} />
              <TurnstileWidget action="staff-reset" onTokenChange={setCaptchaToken} resetKey={captchaResetKey} />
              <Button loading={loading} onClick={startForgotPassword} style={actionButtonStyle(!!forgot.email.trim())}>Send OTP</Button>
            </>
          ) : !forgotOtpVerified ? (
            <>
              <div style={{ marginTop: 24 }}>
                <OtpInputs value={forgot.otp} onChange={value => setForgot(current => ({ ...current, otp: value }))} onComplete={verifyForgotCode} />
              </div>
              <Button loading={loading} onClick={() => void verifyForgotCode()} style={actionButtonStyle(forgot.otp.length === 6)}>Verify code</Button>
              <button onClick={() => void startForgotPassword()} style={{ marginTop: 12, border: 'none', background: 'none', color: '#1f8cff', fontSize: 10 }}>
                Send code again
              </button>
            </>
          ) : (
            <>
              <Input type="password" placeholder="New Password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} style={{ marginTop: 22 }} />
              <div style={{ color: '#7d8797', fontSize: 11, lineHeight: 1.6, marginTop: 14 }}>{PASSWORD_REQUIREMENTS_TEXT}</div>
              <Input type="password" placeholder="Confirm Password" value={confirmResetPassword} onChange={e => setConfirmResetPassword(e.target.value)} style={{ marginTop: 12 }} />
              <Button disabled={!canSubmitReset} loading={loading} onClick={submitPasswordReset} style={actionButtonStyle(canSubmitReset)}>Update password</Button>
            </>
          )}
          <button
            onClick={() => {
              setForgot({ email: '', otp: '' })
              setForgotCodeSent(false)
              setForgotOtpVerified(false)
              setResetPassword('')
              setConfirmResetPassword('')
              setStep('login')
            }}
            style={{ marginTop: 12, border: 'none', background: 'none', color: '#1f8cff', fontSize: 11 }}
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    )
  }

  if (step === 'verify') {
    return (
      <AuthShell mode="provider">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 30, fontWeight: 700 }}>Enter verification code</div>
            <p style={{ color: '#7d8797', marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
              We sent a 6-digit code to {maskEmailAddress(signupVerification.email) || 'your email address'}. Enter it here to finish creating the hospital account.
            </p>
          </div>
          <div style={{ marginTop: 24 }}>
            <OtpInputs
              value={signupVerification.code}
              onChange={value => setSignupVerification(current => ({ ...current, code: value }))}
              onComplete={verifySignupCode}
            />
          </div>
          <TurnstileWidget action="staff-signup-verify" onTokenChange={setCaptchaToken} resetKey={captchaResetKey} />
          <Button loading={loading} onClick={() => void verifySignupCode()} style={actionButtonStyle(signupVerification.code.length === 6)}>
            Verify code
          </Button>
          <button onClick={() => void resendSignupCode()} style={{ marginTop: 12, border: 'none', background: 'none', color: '#1f8cff', fontSize: 10 }}>
            Send code again
          </button>
          <button onClick={() => setStep('signup')} style={{ marginTop: 12, border: 'none', background: 'none', color: '#1f8cff', fontSize: 11 }}>
            Back to sign up
          </button>
        </div>
      </AuthShell>
    )
  }

  if (step === 'reset') {
    return (
      <AuthShell mode="provider">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 30, fontWeight: 700 }}>Choose a new password</div>
            <p style={{ color: '#7d8797', marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
              This password will secure your hospital account going forward.
            </p>
          </div>
          <Input type="password" placeholder="New Password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} style={{ marginTop: 22 }} />
          <div style={{ color: '#7d8797', fontSize: 11, lineHeight: 1.6, marginTop: 14 }}>{PASSWORD_REQUIREMENTS_TEXT}</div>
          <Input type="password" placeholder="Confirm Password" value={confirmResetPassword} onChange={e => setConfirmResetPassword(e.target.value)} style={{ marginTop: 12 }} />
          <Button disabled={!canSubmitReset} loading={loading} onClick={submitPasswordReset} style={actionButtonStyle(canSubmitReset)}>Update password</Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell mode="provider">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#111827', lineHeight: 1.15 }}>Hospital Portal</div>
          <p style={{ color: '#7d8797', marginTop: 8, fontSize: 12 }}>
            Secure access for hospitals and care teams to patient medical records.
          </p>
        </div>

        <SegmentedTabs active={step === 'signup' ? 'signup' : 'login'} onChange={next => setStep(next)} />

        {step === 'login' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 22 }}>
              <Input placeholder="Hospital Name" value={loginForm.hospitalName} onChange={e => setLoginForm(v => ({ ...v, hospitalName: e.target.value }))} />
              <Input placeholder="Gmail address" type="email" value={loginForm.email} onChange={e => setLoginForm(v => ({ ...v, email: e.target.value }))} />
              <Input placeholder="Password" type="password" value={loginForm.password} onChange={e => setLoginForm(v => ({ ...v, password: e.target.value }))} />
            </div>
            <TurnstileWidget action="staff-login" onTokenChange={setCaptchaToken} resetKey={captchaResetKey} />
            <Button disabled={!canSubmitLogin} loading={loading} onClick={submitLogin} style={actionButtonStyle(canSubmitLogin)}>
              Sign in
            </Button>
            <p style={{ marginTop: 14, color: '#7d8797', fontSize: 11, lineHeight: 1.7 }}>
              Sign in with your hospital name, email address, and password.
            </p>
            <button onClick={() => setStep('forgot')} style={{ marginTop: 12, border: 'none', background: 'none', color: '#1f8cff', fontSize: 10 }}>
              Forgotten Password
            </button>
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginTop: 22 }}>
              <Input placeholder="Hospital Name" value={signupForm.hospitalName} onChange={e => setSignupForm(v => ({ ...v, hospitalName: e.target.value }))} />
              <Input placeholder="Gmail address" type="email" value={signupForm.email} onChange={e => setSignupForm(v => ({ ...v, email: e.target.value }))} />
              <Select
                placeholder="Country"
                value={signupForm.country}
                onChange={e => setSignupForm(v => ({ ...v, country: e.target.value, state: '' }))}
                options={COUNTRIES.map(value => ({ value, label: value }))}
              />
              {showStateSelect ? (
                <Select
                  placeholder="State"
                  value={signupForm.state}
                  onChange={e => setSignupForm(v => ({ ...v, state: e.target.value }))}
                  options={stateOptions}
                />
              ) : (
                <Input placeholder="State" value={signupForm.state} onChange={e => setSignupForm(v => ({ ...v, state: e.target.value }))} />
              )}
              <Input placeholder="Password" type="password" value={signupForm.password} onChange={e => setSignupForm(v => ({ ...v, password: e.target.value }))} />
              <Input placeholder="Confirm Password" type="password" value={signupForm.confirmPassword} onChange={e => setSignupForm(v => ({ ...v, confirmPassword: e.target.value }))} />
            </div>
            <TurnstileWidget action="staff-signup" onTokenChange={setCaptchaToken} resetKey={captchaResetKey} />
            <div style={{ color: '#7d8797', fontSize: 11, lineHeight: 1.6, marginTop: 14 }}>{PASSWORD_REQUIREMENTS_TEXT}</div>
            <AuthLegalConsent checked={signupAccepted} onChange={setSignupAccepted} />
            <Button disabled={!canSubmitSignup} loading={loading} onClick={submitHospitalSignup} style={actionButtonStyle(canSubmitSignup)}>
              Create hospital account
            </Button>
            <p style={{ marginTop: 14, color: '#7d8797', fontSize: 11, lineHeight: 1.7 }}>
              Create the first hospital admin account with your hospital name, email, state, country, and password.
            </p>
          </>
        )}
      </div>
    </AuthShell>
  )
}
