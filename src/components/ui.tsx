import React, { useState, useEffect } from 'react'
import { BANNED_ACCOUNT_MESSAGE, isBannedAuthMessage } from '../lib/securityMessages'

// ── Button ──────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
type BtnSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  size?: BtnSize
  loading?: boolean
  icon?: React.ReactNode
  fullWidth?: boolean
}

const btnStyles: Record<BtnVariant, string> = {
  primary: 'background:#1a6fd4;color:#fff;border:none',
  secondary: 'background:#e8f1fc;color:#1a6fd4;border:none',
  danger: 'background:#dc2626;color:#fff;border:none',
  ghost: 'background:transparent;color:#6b7280;border:none',
  outline: 'background:transparent;color:#111827;border:1.5px solid #e5e7eb',
}
const sizeStyles: Record<BtnSize, string> = {
  sm: 'padding:6px 14px;font-size:12px;border-radius:6px',
  md: 'padding:10px 20px;font-size:14px;border-radius:8px',
  lg: 'padding:13px 28px;font-size:15px;border-radius:10px',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  fullWidth,
  children,
  disabled,
  style,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onBlur,
  ...rest
}: ButtonProps) {
  const [pressed, setPressed] = useState(false)
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontWeight: 600, cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled || loading ? 0.6 : 1,
    transition: 'transform 0.08s ease, opacity 0.15s ease, filter 0.08s ease, box-shadow 0.15s ease',
    width: fullWidth ? '100%' : undefined, justifyContent: 'center',
    whiteSpace: 'nowrap',
    touchAction: 'manipulation',
    transform: pressed && !disabled && !loading ? 'scale(0.985)' : 'scale(1)',
    filter: pressed && !disabled && !loading ? 'brightness(0.97)' : 'none',
  }
  // parse inline style strings into proper style objects
  const variantObj = Object.fromEntries(
    btnStyles[variant].split(';').filter(Boolean).map(s => {
      const [k, v] = s.split(':')
      return [k.trim().replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase()), v.trim()]
    })
  )
  const sizeObj = Object.fromEntries(
    sizeStyles[size].split(';').filter(Boolean).map(s => {
      const [k, v] = s.split(':')
      return [k.trim().replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase()), v.trim()]
    })
  )
  return (
    <button
      disabled={disabled || loading}
      style={{ ...base, ...variantObj, ...sizeObj, ...style }}
      onPointerDown={event => {
        setPressed(true)
        onPointerDown?.(event)
      }}
      onPointerUp={event => {
        setPressed(false)
        onPointerUp?.(event)
      }}
      onPointerLeave={event => {
        setPressed(false)
        onPointerLeave?.(event)
      }}
      onBlur={event => {
        setPressed(false)
        onBlur?.(event)
      }}
      {...rest}
    >
      {loading ? <Spinner size={14} color={variant === 'primary' || variant === 'danger' ? '#fff' : '#1a6fd4'} /> : icon}
      {children}
    </button>
  )
}

// ── Input ───────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  icon?: React.ReactNode
  allowReveal?: boolean
}

export function Input({
  label,
  error,
  hint,
  icon,
  style,
  type,
  onFocus,
  onBlur,
  allowReveal = true,
  disabled,
  ...rest
}: InputProps) {
  const [revealed, setRevealed] = useState(false)
  const isPasswordField = type === 'password' && allowReveal
  const resolvedType = isPasswordField ? (revealed ? 'text' : 'password') : type
  const leftPadding = icon ? 38 : 12
  const rightPadding = isPasswordField ? 44 : 12

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{label}</label>
      )}
      <div style={{ position: 'relative' }}>
        {icon && (
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: '#9ca3af', display: 'flex', alignItems: 'center', pointerEvents: 'none'
          }}>{icon}</span>
        )}
        <input
          type={resolvedType}
          disabled={disabled}
          style={{
            width: '100%',
            height: 42,
            padding: `0 ${rightPadding}px 0 ${leftPadding}px`,
            border: `1.5px solid ${error ? '#dc2626' : '#e5e7eb'}`,
            borderRadius: 8,
            fontSize: 14,
            color: '#111827',
            background: '#fff',
            outline: 'none',
            transition: 'border-color 0.15s',
            boxSizing: 'border-box',
            ...style
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = error ? '#dc2626' : '#1a6fd4'
            onFocus?.(e)
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = error ? '#dc2626' : '#e5e7eb'
            onBlur?.(e)
          }}
          {...rest}
        />
        {isPasswordField && (
          <button
            type="button"
            disabled={disabled}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            onClick={() => setRevealed(value => !value)}
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              border: 'none',
              background: 'transparent',
              color: '#6b7280',
              cursor: disabled ? 'not-allowed' : 'pointer',
              padding: 0,
            }}
          >
            {revealed ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M10.7 10.9a2.1 2.1 0 0 0 2.4 2.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.9 4 10 7c-.5 1.5-1.6 3.2-3.3 4.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.2 6.2C4.2 7.7 2.8 9.8 2 12c1.1 3 4.8 7 10 7c1 0 1.9-.1 2.8-.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M2 12c1.1-3 4.8-7 10-7s8.9 4 10 7c-1.1 3-4.8 7-10 7s-8.9-4-10-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            )}
          </button>
        )}
      </div>
      {error && <p style={{ fontSize: 12, color: '#dc2626' }}>{error}</p>}
      {hint && !error && <p style={{ fontSize: 12, color: '#9ca3af' }}>{hint}</p>}
    </div>
  )
}

// ── Select ──────────────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
  placeholder?: string
}

export function Select({ label, error, options, placeholder = 'Select...', style, ...rest }: SelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{label}</label>}
      <div style={{ position: 'relative' }}>
        <select style={{
          width: '100%', height: 42, padding: '0 36px 0 12px',
          border: `1.5px solid ${error ? '#dc2626' : '#e5e7eb'}`,
          borderRadius: 8, fontSize: 14, color: '#111827', background: '#fff',
          appearance: 'none', outline: 'none', cursor: 'pointer', boxSizing: 'border-box', ...style
        }}
          onFocus={e => e.currentTarget.style.borderColor = '#1a6fd4'}
          onBlur={e => e.currentTarget.style.borderColor = error ? '#dc2626' : '#e5e7eb'}
          {...rest}
        >
          <option value="">{placeholder}</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', color: '#9ca3af'
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </div>
      {error && <p style={{ fontSize: 12, color: '#dc2626' }}>{error}</p>}
    </div>
  )
}

// ── Textarea ─────────────────────────────────────────────────────────────────
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}
export function Textarea({ label, error, style, ...rest }: TextareaProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{label}</label>}
      <textarea style={{
        width: '100%', padding: '10px 12px', minHeight: 96,
        border: `1.5px solid ${error ? '#dc2626' : '#e5e7eb'}`,
        borderRadius: 8, fontSize: 14, color: '#111827', background: '#fff',
        outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box', ...style
      }}
        onFocus={e => e.currentTarget.style.borderColor = '#1a6fd4'}
        onBlur={e => e.currentTarget.style.borderColor = error ? '#dc2626' : '#e5e7eb'}
        {...rest}
      />
      {error && <p style={{ fontSize: 12, color: '#dc2626' }}>{error}</p>}
    </div>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────
interface CardProps {
  children: React.ReactNode
  style?: React.CSSProperties
  padding?: number | string
  onClick?: () => void
}
export function Card({ children, style, padding = 24, onClick }: CardProps) {
  return (
    <div onClick={onClick} style={{
      background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb',
      padding, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      cursor: onClick ? 'pointer' : undefined,
      transition: onClick ? 'box-shadow 0.15s' : undefined,
      ...style
    }}>
      {children}
    </div>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────
type BadgeColor = 'blue' | 'green' | 'red' | 'amber' | 'gray'
const badgeMap: Record<BadgeColor, { bg: string; text: string }> = {
  blue:  { bg: '#e8f1fc', text: '#1254a8' },
  green: { bg: '#dcfce7', text: '#15803d' },
  red:   { bg: '#fee2e2', text: '#b91c1c' },
  amber: { bg: '#fef3c7', text: '#b45309' },
  gray:  { bg: '#f3f4f6', text: '#4b5563' },
}
export function Badge({ children, color = 'gray' }: { children: React.ReactNode; color?: BadgeColor }) {
  const { bg, text } = badgeMap[color]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: bg, color: text, fontSize: 11, fontWeight: 600,
      padding: '3px 9px', borderRadius: 999
    }}>{children}</span>
  )
}

// ── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = 20, color = '#1a6fd4' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}
    >
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2.5" strokeDasharray="40" strokeDashoffset="10" strokeLinecap="round" opacity="0.25"/>
      <path d="M12 2a10 10 0 0110 10" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  )
}

export function PageLoader({ label = 'Loading your page...' }: { label?: string }) {
  return (
    <div style={{ minHeight: '42vh', padding: 32, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 999, background: '#fff', border: '1px solid #e5e7eb', color: '#4b5563', fontSize: 14, fontWeight: 600, boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)' }}>
        <Spinner size={16} />
        {label}
      </div>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info'
interface ToastState { id: number; msg: string; type: ToastType }

let toastHandlers: ((msg: string, type: ToastType) => void)[] = []
function toReadableSentence(raw: string) {
  const cleaned = raw
    .replace(/^error:\s*/i, '')
    .replace(/\.$/, '')
    .replace(/^incorrect\s+/i, 'The ')
    .replace(/^enter\s+/i, 'Please enter ')
    .replace(/^add\s+/i, 'Please add ')
    .replace(/^fill\s+/i, 'Please fill ')

  const sentence = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}

function isLowSignalError(lower: string) {
  return (
    lower === 'request failed' ||
    lower === 'failed' ||
    lower === 'error' ||
    lower === 'internal server error' ||
    lower === 'bad request' ||
    lower === 'forbidden' ||
    lower === 'unauthorized' ||
    lower === 'not found' ||
    lower === 'service unavailable' ||
    lower === 'gateway timeout' ||
    lower === 'timeout'
  )
}

function isTechnicalErrorMessage(lower: string, raw: string) {
  return (
    lower.includes('lock:sb-') ||
    lower.includes('auth-token') ||
    lower.includes('lock was stolen by another request') ||
    lower.includes('another request stole it') ||
    lower.includes('navigatorlock') ||
    lower.includes('stack') ||
    lower.includes('trace') ||
    lower.includes('sqlstate') ||
    lower.includes('schema') ||
    lower.includes('relation') ||
    lower.includes('constraint') ||
    lower.includes('postgres') ||
    lower.includes('supabase') ||
    lower.includes('jwt') ||
    lower.includes('refresh token') ||
    lower.includes('rpc') ||
    lower.includes('deno') ||
    lower.includes('referenceerror') ||
    lower.includes('typeerror') ||
    lower.includes('syntaxerror') ||
    lower.includes('column reference') ||
    lower.includes('ambiguous') ||
    lower.includes('stack depth') ||
    lower.includes('recursion') ||
    lower.includes('violates row-level security') ||
    lower.includes('permission denied for relation') ||
    raw.includes('/home/') ||
    raw.includes('<!DOCTYPE') ||
    raw.includes('<html')
  )
}

function fallbackErrorMessage(raw: string) {
  const lower = raw.toLowerCase()
  if (
    lower.includes('lock:sb-') ||
    lower.includes('auth-token') ||
    lower.includes('lock was stolen by another request') ||
    lower.includes('another request stole it')
  ) {
    return 'Your session was updated in another tab or request. Please try again.'
  }
  if (lower.includes('provider request failed with status 401') || lower.includes('provider request failed with status 403')) {
    return 'A connected service rejected this request. Check the admin integration settings and try again.'
  }
  if (lower.includes('provider request failed with status 404')) {
    return 'A connected service could not find the requested data right now.'
  }
  if (lower.includes('provider request failed with status 429')) {
    return 'A connected service is being rate-limited right now. Please wait a moment and try again.'
  }
  if (
    lower.includes('provider request failed with status 500') ||
    lower.includes('provider request failed with status 502') ||
    lower.includes('provider request failed with status 503') ||
    lower.includes('provider request failed with status 504')
  ) {
    return 'A connected service is temporarily unavailable right now. Please try again shortly.'
  }
  if (lower.includes('admin dashboard')) {
    return 'The admin dashboard could not be loaded right now. Refresh and try again.'
  }
  if (lower.includes('sentry')) {
    return 'Sentry data is not available right now.'
  }
  if (lower.includes('posthog')) {
    return 'PostHog data is not available right now.'
  }
  if (lower.includes('timeout') || lower.includes('took too long')) {
    return 'The request took too long to finish. Please try again.'
  }
  if (lower.includes('request failed')) {
    return 'That action could not be completed right now. Please try again.'
  }
  return 'That action could not be completed right now. Please try again.'
}

function normalizeToastMessage(message: string, type: ToastType) {
  const raw = `${message ?? ''}`.replace(/\s+/g, ' ').trim()
  if (!raw) return type === 'error' ? 'Something went wrong. Please try again.' : 'Done.'

  const lower = raw.toLowerCase()
  if (type === 'error') {
    if (lower === 'we could not complete that request right now. please try again.') {
      return 'That action could not be completed right now. Refresh and try again. If it keeps happening, sign out and sign back in.'
    }
    if (lower.includes('over_email_send_rate_limit') || lower.includes('email rate limit exceeded')) {
      return 'Too many verification codes were requested too quickly. Please wait a moment and try again.'
    }
    if (lower.includes('took too long') || lower.includes('timed out') || lower.includes('timeout')) {
      return 'The request is taking too long. Check your internet connection and try again.'
    }
    if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) return 'We could not connect right now. Please try again.'
    if (lower.includes('hid code or access pin')) return 'The HID code or access PIN is not correct.'
    if (lower.includes('multiple (or no) rows returned') || lower.includes('0 rows')) return 'We could not find the information you requested.'
    if (lower.includes('account for this hospital already exists')) return 'A hospital account already exists for this location. Sign in or contact support.'
    if (lower.includes('already linked to a patient account')) return 'This email address is already linked to a patient account. Use a different email for the hospital account.'
    if (lower.includes('cannot be used for a hospital account')) return 'This email address cannot be used for a hospital account. Use a different email address.'
    if (lower.includes('phone number is already linked') || lower.includes('email address or phone number is already linked')) {
      return 'That email address or phone number is already linked to another HID account.'
    }
    if (lower.includes('email address is already linked to an hid account')) {
      return 'That email address is already linked to an HID account. Sign in instead.'
    }
    if (lower.includes('phone number is already linked to another hid account')) {
      return 'That phone number is already linked to another HID account.'
    }
    if (lower.includes('email address and phone number are already linked')) {
      return 'That email address and phone number are already linked to HID accounts.'
    }
    if (lower.includes('idx_hid_patients_phone') || lower.includes('idx_hid_patients_email')) {
      return 'That email address or phone number is already linked to another HID account.'
    }
    if (lower.includes('user already registered')) return 'An account with these details already exists. Sign in instead, or enter the verification code sent to your email.'
    if (lower.includes('duplicate key') || lower.includes('already exists')) return 'An account with these details already exists. Sign in instead or use a different email.'
    if (lower.includes('patient profile already exists')) return 'An account with these details already exists. Sign in instead or enter the verification code sent to your email.'
    if (lower.includes('you do not have permission to perform this action')) return 'Your account is signed in, but it is not allowed to do that yet.'
    if (lower.includes('permission denied') || lower.includes('not allowed') || lower.includes('cannot perform this action')) return 'This account cannot perform that action right now.'
    if (lower.includes('schema cache')) return 'This information could not be saved right now. Please try again.'
    if (lower.includes('invalid input syntax')) return 'Some information is not in the right format. Please review it and try again.'
    if (lower.includes('incorrect otp')) return 'The verification code is not correct.'
    if (lower.includes('incorrect reset otp')) return 'The password reset code is not correct.'
    if (lower.includes('passwords do not match')) return 'The passwords do not match.'
    if (
      lower.includes('invalid credentials') ||
      lower.includes('invalid hospital credentials')
    ) return 'The sign-in details are not correct.'
    if (isBannedAuthMessage(raw)) return BANNED_ACCOUNT_MESSAGE
    if (lower.includes('email not confirmed')) return 'Enter the verification code sent to your email to continue.'
    if (lower.includes('signups not allowed') || lower.includes('phone signups are disabled') || lower.includes('signups not allowed for otp') || (lower.includes('signup') && lower.includes('disabled'))) {
      return 'Patient self-sign-up is currently disabled.'
    }
    if (lower.includes('hospital name, state, and country are required')) return 'Please enter hospital name, state, and country.'
    if (lower.includes('no active staff invite') || lower.includes('staff invite is incomplete')) {
      return 'This hospital account is not ready yet. Sign up again with the same email or sign in to continue setup.'
    }
    if (lower.includes('hospital account setup is incomplete')) {
      return 'This hospital account still needs setup. Sign in again or retry signup with the same email.'
    }
    if (lower.includes('hospital account is still finishing setup') || lower.includes('staff onboarding could not be completed')) {
      return 'Your hospital account is still finishing setup. Sign in again in a moment.'
    }
    if (lower.includes('verify the email to finish creating') || lower.includes('verification code sent to your email')) {
      return 'Enter the 6-digit verification code sent to your email to continue.'
    }
    if (lower.includes('request body must be valid json')) {
      return 'Some information could not be sent correctly. Please try again.'
    }
    if (lower.includes('missing user email')) {
      return 'This email address could not be used for verification. Please try again.'
    }
    if (lower.includes('complete the security check to continue')) {
      return 'Complete the security check before continuing.'
    }
    if (lower.includes('unable to send') && lower.includes('verification code')) {
      return 'We could not send the verification code right now. Please try again.'
    }
    if (lower.includes('unable to send auth email')) {
      return 'We could not send the verification code right now. Please try again.'
    }
    if (lower.includes('unable to send another verification code')) {
      return 'We could not send another verification code right now. Please try again.'
    }
    if (lower.includes('unable to create the hospital account')) {
      return 'We could not start the hospital account right now. Please try again.'
    }
    if (lower.includes('unable to create the account right now')) {
      return 'We could not start sign-up right now. Please try again.'
    }
    if (lower.includes('unable to access this patient right now')) {
      return 'We could not open this patient right now. Check the HID code and Access PIN and try again.'
    }
    if (lower.includes('patient account is locked')) {
      return 'This patient account is locked right now and cannot be opened by a hospital.'
    }
    if (lower.includes('unable to save the medical record')) {
      return 'We could not save the medical record right now. Please try again.'
    }
    if (lower.includes('unable to save the patient profile') || lower.includes('save that profile information')) {
      return 'We could not save those profile changes right now. Review the email address and phone number, then try again.'
    }
    if (
      lower.includes('lock:sb-') ||
      lower.includes('auth-token') ||
      lower.includes('lock was stolen by another request') ||
      lower.includes('another request stole it')
    ) {
      return 'Your session was updated in another tab or request. Please try again.'
    }
    if (lower.includes('aborterror')) {
      return 'The request was interrupted. Please try again.'
    }
    if (lower.includes('jwt') || lower.includes('refresh token')) {
      return 'Your session needs to be refreshed. Please sign in again.'
    }
    if (lower.includes('column reference') || lower.includes('ambiguous') || lower.includes('stack depth') || lower.includes('recursion')) {
      return 'This service is temporarily unavailable right now. Please try again shortly.'
    }
    if (lower.includes('please sign in again')) return 'Please sign in again to continue.'
    if (lower.includes('authentication required') || lower.includes('missing authorization')) return 'Please sign in to continue.'
    if (
      lower.includes('patient was not found') ||
      lower.includes('could not be verified') ||
      lower.includes('account has been deleted') ||
      lower.includes('patient account has been deleted')
    ) return 'We could not verify those details.'
    if (lower.includes('access pin must be 4 to 8 digits')) return 'Access PIN must be 4 to 8 digits.'
    if (lower.includes('not found')) return 'We could not find the information you requested.'
    if (lower.includes('expired')) return 'This session has expired. Please try again.'
  }

  const readable = toReadableSentence(raw)
  if (type === 'error') {
    if (!isLowSignalError(lower) && !isTechnicalErrorMessage(lower, raw)) {
      return readable
    }
    return fallbackErrorMessage(raw)
  }

  return readable
}

export function sanitizeUserFacingMessage(message: string, type: ToastType = 'error') {
  return normalizeToastMessage(message, type)
}

export function showToast(msg: string, type: ToastType = 'info') {
  const normalized = normalizeToastMessage(msg, type)
  toastHandlers.forEach(h => h(normalized, type))
}

export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastState[]>([])
  let counter = 0

  useEffect(() => {
    const handler = (msg: string, type: ToastType) => {
      const id = ++counter
      setToasts(t => [...t, { id, msg, type }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
    }
    toastHandlers.push(handler)
    return () => { toastHandlers = toastHandlers.filter(h => h !== handler) }
  }, [])

  const colors: Record<ToastType, { bg: string; border: string; icon: string }> = {
    success: { bg: '#f0fdf4', border: '#86efac', icon: '✓' },
    error:   { bg: '#fef2f2', border: '#fca5a5', icon: '✕' },
    info:    { bg: '#eff6ff', border: '#93c5fd', icon: 'i' },
  }

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {toasts.map(t => {
        const c = colors[t.type]
        return (
          <div key={t.id} style={{
            background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10,
            padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxWidth: 360, fontSize: 14,
            animation: 'slideIn 0.2s ease',
          }}>
            <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}`}</style>
            <span style={{ fontWeight: 700, fontSize: 12, width: 18, height: 18, borderRadius: '50%', background: c.border, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{c.icon}</span>
            {t.msg}
          </div>
        )
      })}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, description, action }: {
  icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode
}) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ color: '#d1d5db', marginBottom: 4 }}>{icon}</div>
      <p style={{ fontWeight: 600, fontSize: 15, color: '#374151' }}>{title}</p>
      {description && <p style={{ fontSize: 13, color: '#9ca3af', maxWidth: 320 }}>{description}</p>}
      {action}
    </div>
  )
}

// ── Section Header ────────────────────────────────────────────────────────────
export function SectionHeader({ title, subtitle, action }: {
  title: string; subtitle?: string; action?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, width = 480 }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: number
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: width,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)', animation: 'modalIn 0.2s ease', maxHeight: 'calc(100vh - 48px)', overflow: 'hidden'
      }}>
        <style>{`@keyframes modalIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}`}</style>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div style={{ padding: 24, overflowY: 'auto', maxHeight: 'calc(100vh - 132px)' }}>{children}</div>
      </div>
    </div>
  )
}
