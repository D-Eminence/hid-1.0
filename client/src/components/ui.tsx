import React, { useState, useEffect } from 'react'

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
  variant = 'primary', size = 'md', loading, icon, fullWidth, children, disabled, style, ...rest
}: ButtonProps) {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontWeight: 600, cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled || loading ? 0.6 : 1, transition: 'all 0.15s',
    width: fullWidth ? '100%' : undefined, justifyContent: 'center',
    whiteSpace: 'nowrap',
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
    <button disabled={disabled || loading} style={{ ...base, ...variantObj, ...sizeObj, ...style }} {...rest}>
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
}

export function Input({ label, error, hint, icon, style, ...rest }: InputProps) {
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
        <input style={{
          width: '100%', height: 42, padding: icon ? '0 12px 0 38px' : '0 12px',
          border: `1.5px solid ${error ? '#dc2626' : '#e5e7eb'}`,
          borderRadius: 8, fontSize: 14, color: '#111827', background: '#fff',
          outline: 'none', transition: 'border-color 0.15s',
          ...style
        }}
          onFocus={e => e.currentTarget.style.borderColor = error ? '#dc2626' : '#1a6fd4'}
          onBlur={e => e.currentTarget.style.borderColor = error ? '#dc2626' : '#e5e7eb'}
          {...rest}
        />
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
}

export function Select({ label, error, options, style, ...rest }: SelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{label}</label>}
      <div style={{ position: 'relative' }}>
        <select style={{
          width: '100%', height: 42, padding: '0 36px 0 12px',
          border: `1.5px solid ${error ? '#dc2626' : '#e5e7eb'}`,
          borderRadius: 8, fontSize: 14, color: '#111827', background: '#fff',
          appearance: 'none', outline: 'none', cursor: 'pointer', ...style
        }}
          onFocus={e => e.currentTarget.style.borderColor = '#1a6fd4'}
          onBlur={e => e.currentTarget.style.borderColor = error ? '#dc2626' : '#e5e7eb'}
          {...rest}
        >
          <option value="">Select...</option>
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
        outline: 'none', resize: 'vertical', lineHeight: 1.6, ...style
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

// ── Toast ─────────────────────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info'
interface ToastState { id: number; msg: string; type: ToastType }

let toastHandlers: ((msg: string, type: ToastType) => void)[] = []
export function showToast(msg: string, type: ToastType = 'info') {
  toastHandlers.forEach(h => h(msg, type))
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
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)', animation: 'modalIn 0.2s ease'
      }}>
        <style>{`@keyframes modalIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}`}</style>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  )
}
