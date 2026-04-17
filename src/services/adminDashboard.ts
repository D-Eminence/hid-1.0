import type { AdminDashboardOverview, AdminOverviewWindow } from '../types/admin'
import { HidApiError } from '../lib/hidApi'
import { clearAllPortalSessions } from '../lib/auth'
import { NETWORK_TIMEOUT_MESSAGE, fetchWithTimeout, supabase } from '../lib/supabase'

type EdgeEnvelope<T> = {
  data: T
}

function fallbackErrorMessage(raw: string, status: number) {
  const lower = raw.toLowerCase()
  if (lower.includes('sentry')) return 'Sentry data is not available right now.'
  if (lower.includes('posthog')) return 'PostHog data is not available right now.'
  if (lower.includes('provider request failed with status 401') || status === 401) return 'Please sign in to open the admin dashboard.'
  if (lower.includes('provider request failed with status 403') || status === 403) return 'Admin access is limited to platform admins.'
  if (status === 404) return 'The requested admin data could not be found right now.'
  if (status === 408) return NETWORK_TIMEOUT_MESSAGE
  if (status === 429) return 'The admin dashboard is being rate-limited right now. Please wait a moment and try again.'
  if (status >= 500) return 'The admin dashboard is temporarily unavailable right now. Please try again shortly.'
  return 'The admin dashboard could not be loaded right now. Refresh and try again.'
}

function isLowSignalErrorMessage(message: string) {
  const lower = message.toLowerCase()
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
    lower === 'gateway timeout'
  )
}

function requireSupabaseUrl() {
  const value = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!value) throw new HidApiError(500, 'Supabase is not configured for this app.')
  return value
}

function requireSupabaseAnonKey() {
  const value = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!value) throw new HidApiError(500, 'Supabase is not configured for this app.')
  return value
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export async function fetchAdminDashboardOverview(window: AdminOverviewWindow = '7d') {
  const accessToken = await getAccessToken()
  if (!accessToken) {
    throw new HidApiError(401, 'Please sign in to continue.')
  }

  const url = new URL(`${requireSupabaseUrl()}/functions/v1/admin-dashboard-overview`)
  url.searchParams.set('window', window)

  let response: Response
  try {
    response = await fetchWithTimeout(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: requireSupabaseAnonKey(),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('too long')) {
      throw new HidApiError(408, NETWORK_TIMEOUT_MESSAGE, error)
    }
    throw error
  }

  const rawBody = await response.text()
  let parsedPayload = null as
    | (EdgeEnvelope<AdminDashboardOverview> & { error?: string; details?: unknown })
    | { error?: string; details?: unknown }
    | null

  if (rawBody) {
    try {
      parsedPayload = JSON.parse(rawBody) as
        | (EdgeEnvelope<AdminDashboardOverview> & { error?: string; details?: unknown })
        | { error?: string; details?: unknown }
    } catch {
      parsedPayload = null
    }
  }

  if (!response.ok) {
    const rawMessage =
      parsedPayload && typeof parsedPayload === 'object' && 'error' in parsedPayload && typeof parsedPayload.error === 'string'
        ? parsedPayload.error
        : rawBody || response.statusText || ''
    const message = rawMessage && !isLowSignalErrorMessage(rawMessage)
      ? rawMessage
      : fallbackErrorMessage(rawMessage, response.status)

    if (response.status === 401 || message.toLowerCase().includes('please sign in again')) {
      try {
        await supabase.auth.signOut()
      } catch {
        // Best effort only.
      }
      clearAllPortalSessions()
    }

    throw new HidApiError(
      response.status,
      message,
      parsedPayload && typeof parsedPayload === 'object' && 'details' in parsedPayload ? parsedPayload.details : rawBody || parsedPayload
    )
  }

  if (parsedPayload && typeof parsedPayload === 'object' && 'data' in parsedPayload) {
    return parsedPayload.data
  }

  throw new HidApiError(500, 'Admin dashboard returned an unexpected response.')
}
