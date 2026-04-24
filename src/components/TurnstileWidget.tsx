import React, { useEffect, useRef, useState } from 'react'
import { getTurnstileSiteKey } from '../lib/captcha'

declare global {
  interface Window {
    turnstile?: {
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
      existing.addEventListener('error', () => reject(new Error('Turnstile failed to load.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = TURNSTILE_SCRIPT_ID
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile failed to load.'))
    document.head.appendChild(script)
  })

  return turnstileScriptPromise
}

type TurnstileWidgetProps = {
  action: string
  onTokenChange: (token: string | null) => void
  resetKey?: string | number
}

export function TurnstileWidget({ action, onTokenChange, resetKey }: TurnstileWidgetProps) {
  const siteKey = getTurnstileSiteKey() || undefined
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!siteKey || !containerRef.current) return

    let active = true
    void loadTurnstileScript()
      .then(() => {
        if (!active || !containerRef.current || !window.turnstile) return
        if (widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current)
          widgetIdRef.current = null
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          action,
          callback: (token: string) => {
            onTokenChange(token)
            setError('')
          },
          'error-callback': () => {
            onTokenChange(null)
            setError('Security check failed to load. Refresh and try again.')
          },
          'expired-callback': () => {
            onTokenChange(null)
          },
          sitekey: siteKey,
          theme: 'light',
        })
      })
      .catch(() => {
        if (!active) return
        onTokenChange(null)
        setError('Security check failed to load. Refresh and try again.')
      })

    return () => {
      active = false
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [action, onTokenChange, resetKey, siteKey])

  if (!siteKey) return null

  return (
    <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
      <div ref={containerRef} />
      {error ? <div style={{ color: '#b91c1c', fontSize: 11 }}>{error}</div> : null}
    </div>
  )
}
