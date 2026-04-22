import { supabase } from './supabase'

type SentryModule = typeof import('@sentry/react')
type PostHogModule = typeof import('posthog-js').default

type PostHogRuntime = PostHogModule & {
  opt_in_capturing?: () => void
  opt_out_capturing?: () => void
  startSessionRecording?: () => void
  stopSessionRecording?: () => void
}

const PUBLIC_ANALYTICS_PATHS = new Set(['/', '/patient', '/hospital', '/hospital/auth', '/patient/auth', '/doctor/auth'])
const PUBLIC_RECORDING_PATHS = new Set(['/'])

let initialized = false
let sentryClient: SentryModule | null = null
let posthogClient: PostHogRuntime | null = null

function parseSampleRate(value: string | undefined, fallback: number) {
  const parsed = Number.parseFloat(value ?? '')
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

function isAnalyticsAllowed(pathname: string) {
  return PUBLIC_ANALYTICS_PATHS.has(pathname)
}

function isRecordingAllowed(pathname: string) {
  return PUBLIC_RECORDING_PATHS.has(pathname)
}

function sanitizedUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return rawUrl.split('?')[0].split('#')[0]
  }
}

function redactSentryEvent(event: Record<string, any>) {
  if (event.request?.url) {
    event.request.url = sanitizedUrl(event.request.url)
  }

  if (event.user) {
    event.user = {
      id: event.user.id,
    }
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.filter((breadcrumb: Record<string, any>) => {
      if (breadcrumb.category === 'ui.input') return false
      if (typeof breadcrumb.message === 'string' && breadcrumb.message.toLowerCase().includes('password')) return false
      return true
    })
  }

  return event
}

function getSentryEventText(event: Record<string, any>) {
  const exceptionValues = Array.isArray(event.exception?.values) ? event.exception.values : []
  return [
    typeof event.message === 'string' ? event.message : '',
    typeof event.culprit === 'string' ? event.culprit : '',
    ...exceptionValues.flatMap((value: Record<string, unknown>) => [
      typeof value.type === 'string' ? value.type : '',
      typeof value.value === 'string' ? value.value : '',
    ]),
  ]
    .join(' ')
    .toLowerCase()
}

function shouldIgnoreSentryEvent(event: Record<string, any>) {
  const text = getSentryEventText(event)
  return (
    text.includes('lock broken by another request') ||
    text.includes('lock request is aborted') ||
    text.includes("steal' option") ||
    text.includes('lock was stolen by another request') ||
    text.includes('lock "') && text.includes('was released because another request stole it') ||
    text.includes('another request stole it') ||
    (text.includes('serviceworker') && text.includes('service-worker.js')) ||
    text.includes('failed to update a serviceworker') ||
    text.includes('unknown error occurred when fetching the script')
  )
}

async function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return

  const Sentry = await import('@sentry/react')
  sentryClient = Sentry

  const integrations: any[] = []
  if (typeof Sentry.browserTracingIntegration === 'function') {
    integrations.push(Sentry.browserTracingIntegration())
  }
  if (typeof Sentry.supabaseIntegration === 'function') {
    integrations.push(Sentry.supabaseIntegration({ supabaseClient: supabase }))
  }

  Sentry.init({
    beforeSend(event) {
      const redactedEvent = redactSentryEvent(event as Record<string, any>)
      if (shouldIgnoreSentryEvent(redactedEvent)) {
        return null
      }
      return redactedEvent as typeof event
    },
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? import.meta.env.MODE,
    integrations,
    sendDefaultPii: false,
    tracesSampleRate: parseSampleRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string | undefined, 0.1),
  })
}

async function initPostHog() {
  const apiHost = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com'
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined
  if (!key) return

  const module = await import('posthog-js')
  posthogClient = module.default as PostHogRuntime
  posthogClient.init(key, {
    api_host: apiHost,
    autocapture: true,
    capture_pageview: false,
    disable_session_recording: true,
    mask_all_text: true,
    persistence: 'localStorage+cookie',
  })
}

export async function initObservability() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  await Promise.allSettled([
    initSentry(),
    initPostHog(),
  ])
}

export function updateObservabilityForRoute(pathname: string) {
  const analyticsAllowed = isAnalyticsAllowed(pathname)
  const recordingAllowed = isRecordingAllowed(pathname)

  if (posthogClient) {
    if (analyticsAllowed) {
      posthogClient.opt_in_capturing?.()
      posthogClient.capture('$pageview', {
        path: pathname,
        url: sanitizedUrl(window.location.href),
      })
    } else {
      posthogClient.opt_out_capturing?.()
    }

    if (recordingAllowed) {
      posthogClient.startSessionRecording?.()
    } else {
      posthogClient.stopSessionRecording?.()
    }
  }

  if (sentryClient) {
    sentryClient.setTag('hid.route_visibility', analyticsAllowed ? 'public' : 'protected')
    sentryClient.setTag('hid.route_path', pathname)
  }
}

export function identifyObservabilityUser(params: {
  appRole: string
  id: string
  staffRole?: string | null
}) {
  if (posthogClient) {
    posthogClient.identify(params.id, {
      app_role: params.appRole,
      staff_role: params.staffRole ?? undefined,
    })
  }

  if (sentryClient) {
    sentryClient.setUser({ id: params.id })
    sentryClient.setTag('hid.app_role', params.appRole)
    if (params.staffRole) {
      sentryClient.setTag('hid.staff_role', params.staffRole)
    }
  }
}

export function clearObservabilityIdentity() {
  posthogClient?.reset()
  sentryClient?.setUser(null)
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (!posthogClient) return
  if (!isAnalyticsAllowed(window.location.pathname)) return
  posthogClient.capture(event, properties)
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (sentryClient) {
    sentryClient.captureException(error, {
      extra: context,
    })
  } else {
    console.error(error, context)
  }
}
