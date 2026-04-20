import React, { useEffect, useMemo, useState } from 'react'
import { HIDLogo } from './HIDLogo'
import { Button } from './ui'

type DeferredInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISS_KEY = 'hid:install-prompt-dismissed-at'
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000

function canShowInstallPrompt() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return false
  const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? '0')
  return !dismissedAt || Date.now() - dismissedAt > DISMISS_TTL_MS
}

export function AppInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !canShowInstallPrompt()) return undefined

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as DeferredInstallPromptEvent)
      setVisible(true)
    }

    const handleInstalled = () => {
      setVisible(false)
      setDeferredPrompt(null)
      localStorage.removeItem(DISMISS_KEY)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const description = useMemo(() => (
    'Install HID on this device for faster access from your home screen and a more app-like experience.'
  ), [])

  async function install() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome === 'accepted') {
      setVisible(false)
      setDeferredPrompt(null)
      localStorage.removeItem(DISMISS_KEY)
      return
    }
    dismiss()
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, `${Date.now()}`)
    setVisible(false)
  }

  if (!visible || !deferredPrompt) return null

  return (
    <div
      style={{
        position: 'fixed',
        right: 18,
        bottom: 18,
        zIndex: 120,
        width: 'min(360px, calc(100vw - 24px))',
        background: '#ffffff',
        border: '1px solid #dbe8f8',
        borderRadius: 18,
        boxShadow: '0 18px 44px rgba(15, 23, 42, 0.16)',
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ paddingTop: 2 }}>
          <HIDLogo size="xs" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Install HID</div>
          <div style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.6, marginTop: 4 }}>{description}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <Button size="sm" variant="outline" onClick={dismiss}>Not now</Button>
        <Button size="sm" onClick={() => void install()}>Add to device</Button>
      </div>
    </div>
  )
}
