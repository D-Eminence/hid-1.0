// PostHog analytics + Sentry error tracking
let ph: typeof import('posthog-js').default | null = null

export async function initAnalytics() {
  const key = import.meta.env.VITE_POSTHOG_KEY
  const host = import.meta.env.VITE_POSTHOG_HOST ?? 'https://app.posthog.com'
  if (!key) return
  const { default: posthog } = await import('posthog-js')
  posthog.init(key, { api_host: host, autocapture: true })
  ph = posthog
}

export function track(event: string, props?: Record<string, unknown>) {
  ph?.capture(event, props)
}

export function identify(userId: string, traits?: Record<string, unknown>) {
  ph?.identify(userId, traits)
}
