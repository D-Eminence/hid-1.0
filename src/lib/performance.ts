import { initObservability } from './observabilityBridge'

function addHeadLink(rel: 'dns-prefetch' | 'preconnect', href: string, crossOrigin = false) {
  if (typeof document === 'undefined' || !href) return

  const existing = document.head.querySelector(`link[rel="${rel}"][href="${href}"]`)
  if (existing) return

  const link = document.createElement('link')
  link.rel = rel
  link.href = href
  if (crossOrigin && rel === 'preconnect') {
    link.crossOrigin = 'anonymous'
  }
  document.head.appendChild(link)
}

function safeOrigin(raw: string | undefined) {
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

function runWhenIdle(task: () => void, timeoutMs = 1500) {
  if (typeof window === 'undefined') return () => undefined

  const idleWindow = window as Window & {
    requestIdleCallback?: (task: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }

  if (typeof idleWindow.requestIdleCallback === 'function') {
    const idleId = idleWindow.requestIdleCallback(task, { timeout: timeoutMs })
    return () => idleWindow.cancelIdleCallback?.(idleId)
  }

  const timer = globalThis.setTimeout(task, Math.min(timeoutMs, 250))
  return () => globalThis.clearTimeout(timer)
}

export function warmCriticalConnections() {
  if (typeof window === 'undefined') return

  const origins = new Set<string>([
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
  ])

  const supabaseOrigin = safeOrigin(import.meta.env.VITE_SUPABASE_URL as string | undefined)
  const posthogOrigin = safeOrigin(import.meta.env.VITE_POSTHOG_HOST as string | undefined)
  const sentryOrigin = safeOrigin(import.meta.env.VITE_SENTRY_DSN as string | undefined)

  ;[supabaseOrigin, posthogOrigin, sentryOrigin].forEach(origin => {
    if (origin) origins.add(origin)
  })

  origins.forEach(origin => {
    addHeadLink('dns-prefetch', origin)
    addHeadLink('preconnect', origin, true)
  })
}

export function scheduleNonCriticalStartup() {
  if (typeof window === 'undefined') return

  const start = () => {
    runWhenIdle(() => {
      initObservability()
      void import('./pwa').then(module => module.registerAppServiceWorker())
    })
  }

  if (document.readyState === 'complete') {
    start()
    return
  }

  window.addEventListener('load', start, { once: true })
}
