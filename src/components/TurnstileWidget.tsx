import React, { useCallback, useEffect, useRef, useState } from 'react'
import { getTurnstileSiteKey } from '../lib/captcha'

declare global {
  interface Window {
    turnstile?: {
      execute: (widgetId: string) => void
      remove: (widgetId: string) => void
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      reset: (widgetId?: string) => void
    }
  }
}

const TURNSTILE_SCRIPT_ID = 'hid-turnstile-script'
let turnstileScriptPromise: Promise<void> | null = null

function loadTurnstileScript() {
  if (turnstileScriptPromise) return turnstileScriptPromise

  turnstileScriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve()
      return
    }

    const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => {
        turnstileScriptPromise = null
        reject(new Error('Turnstile failed to load.'))
      }, { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = TURNSTILE_SCRIPT_ID
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      turnstileScriptPromise = null
      reject(new Error('Turnstile failed to load.'))
    }
    document.head.appendChild(script)
  })

  return turnstileScriptPromise
}

type TurnstileWidgetProps = {
  action: string
  message?: string | null
  messageTone?: 'error' | 'info'
  onTokenChange: (token: string | null) => void
  preload?: boolean
  resetKey?: string | number
  token?: string | null
  visible?: boolean
}

function noticeStyles(tone: 'error' | 'info') {
  return tone === 'error'
    ? {
        background: '#fef2f2',
        border: '#fecaca',
        color: '#b91c1c',
      }
    : {
        background: '#eff6ff',
        border: '#bfdbfe',
        color: '#1d4ed8',
      }
}

export function TurnstileWidget({
  action,
  message,
  messageTone = 'info',
  onTokenChange,
  preload = false,
  resetKey,
  token,
  visible = true,
}: TurnstileWidgetProps) {
  const siteKey = getTurnstileSiteKey() || undefined
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [error, setError] = useState('')
  const [widgetReady, setWidgetReady] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const shouldLoad = visible || preload

  const beginVerification = useCallback(() => {
    if (!widgetIdRef.current || !window.turnstile) {
      setError('Security check is still loading. Please wait a moment and try again.')
      return
    }

    if (token) {
      onTokenChange(null)
    }

    setError('')
    setVerifying(true)
    window.turnstile.reset(widgetIdRef.current)
    window.turnstile.execute(widgetIdRef.current)
  }, [onTokenChange, token])

  useEffect(() => {
    if (!siteKey || !shouldLoad) return

    let active = true
    void loadTurnstileScript()
      .then(() => {
        if (!active) return
        setError('')
      })
      .catch(() => {
        if (!active) return
        setError('Security check failed to load. Refresh and try again.')
      })

    return () => {
      active = false
    }
  }, [shouldLoad, siteKey])

  useEffect(() => {
    if (!siteKey || !containerRef.current || !visible) return

    let active = true
    setError('')
    setWidgetReady(false)
    setVerifying(false)
    void loadTurnstileScript()
      .then(() => {
        if (!active || !containerRef.current || !window.turnstile) return
        if (widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current)
          widgetIdRef.current = null
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          action,
          appearance: 'always',
          callback: (token: string) => {
            onTokenChange(token)
            setError('')
            setVerifying(false)
          },
          execution: 'execute',
          'error-callback': () => {
            onTokenChange(null)
            setError('We could not complete the security check. Check your connection and verify again.')
            setVerifying(false)
          },
          'expired-callback': () => {
            onTokenChange(null)
            setError('The security check expired. Verify again to continue.')
            setVerifying(false)
          },
          'refresh-expired': 'manual',
          'refresh-timeout': 'manual',
          retry: 'never',
          size: 'flexible',
          sitekey: siteKey,
          theme: 'light',
          'timeout-callback': () => {
            onTokenChange(null)
            setError('The security check timed out. Verify again to continue.')
            setVerifying(false)
          },
        })
        setWidgetReady(true)
      })
      .catch(() => {
        if (!active) return
        onTokenChange(null)
        setError('Security check failed to load. Refresh and try again.')
        setWidgetReady(false)
        setVerifying(false)
      })

    return () => {
      active = false
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [action, onTokenChange, resetKey, siteKey, visible])

  useEffect(() => {
    if (!visible) return

    if (token) {
      setVerifying(false)
      setError('')
    }
  }, [token, visible])

  if (!siteKey || (!visible && !preload)) return null

  if (!visible) return null

  const activeNotice = error
    ? { message: error, tone: 'error' as const }
    : verifying
      ? { message: 'Verifying security check...', tone: 'info' as const }
      : token
        ? { message: 'Security check complete. You can continue.', tone: 'info' as const }
        : message
          ? { message, tone: messageTone }
          : { message: 'Select "Verify you\'re human" to continue.', tone: 'info' as const }

  const styles = noticeStyles(activeNotice.tone)
  const showPlaceholder = !widgetReady
  const buttonLabel = token ? 'Verified' : verifying ? 'Verifying...' : 'Verify you\'re human'
  const buttonStyles = token
    ? {
        background: '#f0fdf4',
        border: '1px solid #86efac',
        color: '#166534',
      }
    : {
        background: '#ffffff',
        border: '1px solid #cbd5e1',
        color: '#0f172a',
      }

  return (
    <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
      <div
        aria-live="polite"
        style={{
          background: styles.background,
          border: `1px solid ${styles.border}`,
          borderRadius: 12,
          color: styles.color,
          fontSize: 12,
          lineHeight: 1.5,
          padding: '10px 12px',
        }}
      >
        {activeNotice.message}
      </div>
      <button
        type="button"
        disabled={!widgetReady || verifying || !!token}
        onClick={beginVerification}
        style={{
          alignItems: 'center',
          borderRadius: 10,
          cursor: !widgetReady || verifying || token ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          fontSize: 13,
          fontWeight: 600,
          gap: 8,
          justifyContent: 'center',
          opacity: !widgetReady || verifying || token ? 0.7 : 1,
          padding: '10px 14px',
          transition: 'opacity 0.15s ease, transform 0.08s ease',
          ...buttonStyles,
        }}
      >
        {buttonLabel}
      </button>
      {showPlaceholder ? (
        <div
          aria-hidden="true"
          style={{
            alignItems: 'center',
            background: '#f8fafc',
            border: '1px dashed #cbd5e1',
            borderRadius: 12,
            color: '#64748b',
            display: 'flex',
            fontSize: 12,
            justifyContent: 'center',
            minHeight: 74,
            padding: '12px 14px',
          }}
        >
          Loading security check...
        </div>
      ) : null}
      <div ref={containerRef} style={showPlaceholder ? { minHeight: 0 } : undefined} />
    </div>
  )
}
