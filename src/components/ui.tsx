import React, { useEffect, useRef, useState } from 'react'

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

const btnStyles: Record<BtnVariant, React.CSSProperties> = {
  primary: { background: '#1a6fd4', color: '#fff', border: 'none' },
  secondary: { background: '#e8f1fc', color: '#1a6fd4', border: 'none' },
  danger: { background: '#dc2626', color: '#fff', border: 'none' },
  ghost: { background: 'transparent', color: '#6b7280', border: 'none' },
  outline: { background: 'transparent', color: '#1a6fd4', border: '1.5px solid #1a6fd4' },
}
const sizeStyles: Record<BtnSize, React.CSSProperties> = {
  sm: { padding: '6px 14px', fontSize: 12, borderRadius: 6 },
  md: { padding: '10px 20px', fontSize: 14, borderRadius: 8 },
  lg: { padding: '13px 28px', fontSize: 15, borderRadius: 10 },
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
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontWeight: 600, cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled || loading ? 0.6 : 1,
    transition: 'transform 0.08s ease, opacity 0.15s ease, filter 0.08s ease, box-shadow 0.15s ease',
    width: fullWidth ? '100%' : undefined, justifyContent: 'center',
    whiteSpace: 'nowrap',
    touchAction: 'manipulation',
    transform: 'scale(1)',
    filter: 'none',
  }
  return (
    <button
      disabled={disabled || loading}
      style={{ ...base, ...btnStyles[variant], ...sizeStyles[size], ...style }}
      onPointerDown={event => {
        if (!disabled && !loading) {
          event.currentTarget.style.transform = 'scale(0.985)'
          event.currentTarget.style.filter = 'brightness(0.97)'
        }
        onPointerDown?.(event)
      }}
      onPointerUp={event => {
        event.currentTarget.style.transform = 'scale(1)'
        event.currentTarget.style.filter = 'none'
        onPointerUp?.(event)
      }}
      onPointerLeave={event => {
        event.currentTarget.style.transform = 'scale(1)'
        event.currentTarget.style.filter = 'none'
        onPointerLeave?.(event)
      }}
      onBlur={event => {
        event.currentTarget.style.transform = 'scale(1)'
        event.currentTarget.style.filter = 'none'
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
            onClick={() => setRevealed((value: boolean) => !value)}
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
  const resolvedPadding = typeof padding === 'number' ? `clamp(12px, 3.5vw, ${padding}px)` : padding
  return (
    <div onClick={onClick} style={{
      background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb',
      padding: resolvedPadding, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      cursor: onClick ? 'pointer' : undefined,
      transition: onClick ? 'box-shadow 0.15s' : undefined,
      minWidth: 0,
      ...style
    }}>
      {children}
    </div>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────
export type BadgeColor = 'blue' | 'green' | 'red' | 'amber' | 'gray'
export const badgeMap: Record<BadgeColor, { bg: string; text: string }> = {
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

export { ToastProvider, sanitizeUserFacingMessage, showToast } from './toast'

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
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'clamp(14px, 4vw, 20px)', gap: 16, flexWrap: 'wrap', rowGap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ fontSize: 'clamp(15px, 3.5vw, 18px)', fontWeight: 700, letterSpacing: '-0.3px' }}>{title}</h2>
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
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 'clamp(10px, 4vw, 24px)'
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: width,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)', animation: 'modalIn 0.2s ease', maxHeight: 'calc(100vh - 48px)', overflow: 'hidden'
      }}>
        <style>{`@keyframes modalIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}`}</style>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 'clamp(14px, 4vw, 20px) clamp(16px, 4vw, 24px)', borderBottom: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div style={{ padding: 'clamp(16px, 4vw, 24px)', overflowY: 'auto', overflowX: 'hidden', maxHeight: 'calc(100vh - 132px)' }}>{children}</div>
      </div>
    </div>
  )
}

// ── Bottom Sheet ──────────────────────────────────────────────────────────────
export function BottomSheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number } | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  function handlePointerDown(event: React.PointerEvent) {
    dragRef.current = { startY: event.clientY }
  }
  function handlePointerMove(event: React.PointerEvent) {
    if (!dragRef.current || !sheetRef.current) return
    const delta = event.clientY - dragRef.current.startY
    if (delta > 0) sheetRef.current.style.transform = `translateY(${delta}px)`
  }
  function handlePointerUp(event: React.PointerEvent) {
    if (!dragRef.current || !sheetRef.current) return
    const delta = event.clientY - dragRef.current.startY
    dragRef.current = null
    if (delta > 80) {
      onClose()
    } else {
      sheetRef.current.style.transform = ''
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={sheetRef}
        style={{
          background: '#fff', width: '100%', maxWidth: 560,
          borderRadius: '20px 20px 0 0', maxHeight: '92vh', minHeight: '40vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
          animation: 'sheetIn 0.25s ease', transition: 'transform 0.2s ease',
        }}
      >
        <style>{`@keyframes sheetIn{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ padding: 'clamp(10px, 3vw, 14px) clamp(16px, 4vw, 24px) 14px', cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 999, background: '#e5e7eb', margin: '0 auto 14px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>{title}</h3>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#9ca3af', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>
        <div style={{ padding: '0 clamp(16px, 4vw, 24px) clamp(16px, 4vw, 24px)', overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  )
}

// ── Chips ─────────────────────────────────────────────────────────────────────
export function Chip({ active, onClick, children, disabled }: {
  active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: `1px solid ${active ? '#1a6fd4' : '#e5e7eb'}`,
        borderRadius: 999,
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: active ? '#e8f1fc' : '#fff',
        color: active ? '#1a6fd4' : '#484f58',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}

export function ChipGroup({ options, value, onChange }: {
  options: { value: string; label: string }[]; value: string; onChange: (value: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map(option => (
        <Chip key={option.value} active={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </Chip>
      ))}
    </div>
  )
}

// ── Selection Cards ───────────────────────────────────────────────────────────
export function SelectionCard({ label, description, icon, active, onClick }: {
  label: string; description?: string; icon?: React.ReactNode; active: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        border: `1.5px solid ${active ? '#1a6fd4' : '#e5e7eb'}`,
        background: active ? '#e8f1fc' : '#fff',
        borderRadius: 12,
        padding: 14,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      }}
    >
      {icon && <span style={{ color: active ? '#1a6fd4' : '#6b7280' }}>{icon}</span>}
      <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{label}</span>
      {description && <span style={{ fontSize: 12, color: '#6b7280' }}>{description}</span>}
    </button>
  )
}

export function SelectionCardGrid({ options, value, onChange }: {
  options: { value: string; label: string; description?: string; icon?: React.ReactNode }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
      {options.map(option => (
        <SelectionCard
          key={option.value}
          label={option.label}
          description={option.description}
          icon={option.icon}
          active={value === option.value}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  )
}

// ── Full Screen Flow ─────────────────────────────────────────────────────────
export function FullScreenFlow({ open, title, onBack, onClose, step, totalSteps, children, footer }: {
  open: boolean
  title: string
  onBack?: () => void
  onClose: () => void
  step?: number
  totalSteps?: number
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 1100, display: 'flex', flexDirection: 'column', animation: 'fullScreenIn 0.2s ease' }}>
      <style>{`@keyframes fullScreenIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{ padding: 'clamp(14px, 4vw, 20px) clamp(16px, 4vw, 24px)', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onBack ? (
            <button onClick={onBack} aria-label="Back" style={{ background: 'none', border: 'none', color: '#374151', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          ) : <span style={{ width: 28, flexShrink: 0 }} />}
          <h3 style={{ fontSize: 16, fontWeight: 700, flex: 1, minWidth: 0, overflowWrap: 'anywhere', textAlign: 'center' }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#9ca3af', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>
        {step !== undefined && totalSteps !== undefined && totalSteps > 1 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
            {Array.from({ length: totalSteps }).map((_, index) => (
              <span key={index} style={{ flex: 1, height: 3, borderRadius: 999, background: index <= step ? '#1a6fd4' : '#e5e7eb' }} />
            ))}
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 'clamp(16px, 4vw, 24px)' }}>{children}</div>
      {footer && (
        <div style={{ borderTop: '1px solid #e5e7eb', padding: 'clamp(12px, 4vw, 20px) clamp(16px, 4vw, 24px)', display: 'flex', gap: 12, justifyContent: 'flex-end', flexShrink: 0 }}>
          {footer}
        </div>
      )}
    </div>
  )
}
