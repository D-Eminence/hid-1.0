import type {
  AdminCreatePlatformAdminResponse,
  AdminDashboardOverview,
  AdminManagedUser,
  AdminOverviewWindow,
  AdminOutreachRolePolicy,
  AdminPlatformControls,
  AdminPlatformControlsResponse,
  AdminRoleManagementResponse,
  AdminStaffRolePolicy,
  AdminUsersExportFilters,
  AdminUsersExportFormat,
  AdminUsersExportStartResponse,
  AdminUserActionResponse,
  AdminUserDirectoryResponse,
  AdminUserManagementAction,
} from '../types/admin'
import { HidApiError } from '../lib/hidApi'
import { clearAllPortalSessions } from '../lib/auth'
import { BANNED_ACCOUNT_MESSAGE, isBannedAuthMessage } from '../lib/securityMessages'
import { NETWORK_TIMEOUT_MESSAGE, fetchWithTimeout, getSafeSession, safeSignOut } from '../lib/supabase'

type EdgeEnvelope<T> = {
  data: T
}

const inflightOverviewRequests = new Map<string, Promise<AdminDashboardOverview>>()
const overviewCache = new Map<string, { expiresAt: number; value: AdminDashboardOverview }>()
const inflightUserSearchRequests = new Map<string, Promise<AdminManagedUser[]>>()
const inflightDeletedUserRequests = new Map<string, Promise<AdminManagedUser[]>>()
const inflightRoleManagementRequest = new Map<string, Promise<AdminRoleManagementResponse>>()
const inflightPlatformControlsRequest = new Map<string, Promise<AdminPlatformControls>>()
const userSearchCache = new Map<string, { expiresAt: number; value: AdminManagedUser[] }>()
const deletedUserCache = new Map<string, { expiresAt: number; value: AdminManagedUser[] }>()
const roleManagementCache = new Map<string, { expiresAt: number; value: AdminRoleManagementResponse }>()
const platformControlsCache = new Map<string, { expiresAt: number; value: AdminPlatformControls }>()
const OVERVIEW_CACHE_TTL_MS = 30000
const USER_SEARCH_CACHE_TTL_MS = 15000
const ADMIN_CONTROLS_CACHE_TTL_MS = 15000

function overviewCacheKey(window: AdminOverviewWindow, date: string | null | undefined) {
  return `${window}:${date?.trim() ?? ''}`
}

function fallbackErrorMessage(raw: string, status: number, fallbackMessage = 'The admin dashboard could not be loaded right now. Refresh and try again.') {
  const lower = raw.toLowerCase()
  if (lower.includes('sentry')) return 'Sentry data is not available right now.'
  if (lower.includes('posthog')) return 'PostHog data is not available right now.'
  if (lower.includes('provider request failed with status 401') || status === 401) return 'Please sign in to open the admin dashboard.'
  if (lower.includes('provider request failed with status 403') || status === 403) return 'Admin access is limited to platform admins.'
  if (isBannedAuthMessage(raw)) return BANNED_ACCOUNT_MESSAGE
  if (status === 404) return 'The requested admin data could not be found right now.'
  if (status === 408) return NETWORK_TIMEOUT_MESSAGE
  if (status === 429) return 'The admin dashboard is being rate-limited right now. Please wait a moment and try again.'
  if (status >= 500) return 'The admin dashboard is temporarily unavailable right now. Please try again shortly.'
  return fallbackMessage
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

function sanitizeAdminDashboardMessage(raw: string, status: number, fallbackMessage?: string) {
  const lower = raw.toLowerCase()
  if (
    lower.includes('lock:sb-') ||
    lower.includes('auth-token') ||
    lower.includes('lock was stolen by another request') ||
    lower.includes('another request stole it')
  ) {
    return 'Your session was updated in another tab or request. Please try again.'
  }
  if (lower.includes('jwt') || lower.includes('refresh token')) {
    return 'Please sign in again to continue.'
  }
  if (lower.includes('provider request failed with status 401') || status === 401) {
    return 'Please sign in to open the admin dashboard.'
  }
  if (lower.includes('provider request failed with status 403') || status === 403) {
    return 'Admin access is limited to platform admins.'
  }
  if (lower.includes('query is required') || lower.includes('hid code or email')) {
    return 'Enter an HID code or email to search.'
  }
  if (lower.includes('platform admin accounts cannot be deleted')) {
    return 'Platform admin accounts cannot be deleted from the dashboard.'
  }
  if (lower.includes('platform admin accounts cannot be locked')) {
    return 'Platform admin accounts cannot be locked from the dashboard.'
  }
  if (lower.includes('platform admin accounts cannot be modified')) {
    return 'Platform admin accounts cannot be changed from the dashboard.'
  }
  if (lower.includes('no users matched the selected export criteria')) {
    return 'No users matched the selected export criteria.'
  }
  if (lower.includes('staff account could not be found')) {
    return 'We could not find that hospital account right now.'
  }
  if (lower.includes('patient account could not be found')) {
    return 'We could not find that patient account right now.'
  }
  if (lower.includes('account was already deleted')) {
    return 'This account has already been deleted.'
  }
  if (lower.includes('account has been deleted')) {
    return 'This account is unavailable right now.'
  }
  if (lower.includes('sentry')) return 'Sentry data is not available right now.'
  if (lower.includes('posthog')) return 'PostHog data is not available right now.'
  return fallbackErrorMessage(raw, status, fallbackMessage)
}

function parseAdminRequestAction(init: RequestInit) {
  if (typeof init.body !== 'string') return null
  try {
    const parsed = JSON.parse(init.body) as { action?: unknown }
    return typeof parsed.action === 'string' ? parsed.action : null
  } catch {
    return null
  }
}

function getAdminEndpointFallbackMessage(path: string, init: RequestInit, status: number) {
  const lowerPath = path.toLowerCase()
  const action = parseAdminRequestAction(init)

  if (lowerPath.includes('admin-role-management')) {
    if (action === 'create_admin') {
      if (status === 401) return 'Please sign in to create a platform admin.'
      if (status === 403) return 'Admin access is limited to platform admins.'
      if (status === 404) return 'The platform admin account could not be created right now.'
      if (status === 408) return 'The platform admin request took too long. Please try again.'
      if (status === 429) return 'Platform admin creation is being rate-limited right now. Please wait a moment and try again.'
      if (status >= 500) return 'The platform admin could not be created right now. Please try again shortly.'
      return 'The platform admin could not be created right now. Refresh and try again.'
    }

    if (action === 'update_staff_role_policy') {
      if (status === 401) return 'Please sign in to update hospital RBAC settings.'
      if (status === 403) return 'Admin access is limited to platform admins.'
      if (status === 408) return 'The hospital RBAC request took too long. Please try again.'
      if (status >= 500) return 'The hospital RBAC settings could not be updated right now. Please try again shortly.'
      return 'The hospital RBAC settings could not be updated right now. Refresh and try again.'
    }

    if (action === 'update_outreach_role_policy') {
      if (status === 401) return 'Please sign in to update outreach RBAC settings.'
      if (status === 403) return 'Admin access is limited to platform admins.'
      if (status === 408) return 'The outreach RBAC request took too long. Please try again.'
      if (status >= 500) return 'The outreach RBAC settings could not be updated right now. Please try again shortly.'
      return 'The outreach RBAC settings could not be updated right now. Refresh and try again.'
    }

    if (status === 401) return 'Please sign in to open admin role settings.'
    if (status === 403) return 'Admin access is limited to platform admins.'
    if (status === 408) return 'The admin role settings request took too long. Please try again.'
    if (status === 429) return 'Admin role settings are being rate-limited right now. Please wait a moment and try again.'
    if (status >= 500) return 'Admin role settings are temporarily unavailable right now. Please try again shortly.'
    return 'Admin role settings could not be loaded right now. Refresh and try again.'
  }

  if (lowerPath.includes('admin-platform-controls')) {
    if (status === 401) return 'Please sign in to open platform controls.'
    if (status === 403) return 'Admin access is limited to platform admins.'
    if (status === 408) return 'The platform controls request took too long. Please try again.'
    if (status === 429) return 'Platform controls are being rate-limited right now. Please wait a moment and try again.'
    if (status >= 500) return 'Platform controls are temporarily unavailable right now. Please try again shortly.'
    return 'Platform controls could not be loaded right now. Refresh and try again.'
  }

  if (lowerPath.includes('admin-user-management')) {
    const method = `${init.method ?? 'GET'}`.toUpperCase()
    if (method === 'GET') {
      if (status === 401) return 'Please sign in to open the user directory.'
      if (status === 403) return 'Admin access is limited to platform admins.'
      if (status === 408) return 'The user directory request took too long. Please try again.'
      if (status >= 500) return 'The user directory could not be loaded right now. Please try again shortly.'
      return 'The user directory could not be loaded right now. Refresh and try again.'
    }
    if (status === 401) return 'Please sign in to continue.'
    if (status === 403) return 'Admin access is limited to platform admins.'
    if (status === 408) return 'This admin action took too long. Please try again.'
    if (status >= 500) return 'This admin action could not be completed right now. Please try again shortly.'
    return 'This admin action could not be completed right now. Refresh and try again.'
  }

  if (lowerPath.includes('admin-user-export')) {
    const action = parseAdminRequestAction(init)
    if (action === 'start') {
      if (status === 401) return 'Please sign in to export users.'
      if (status === 403) return 'Admin access is limited to platform admins.'
      if (status === 408) return 'The export verification request took too long. Please try again.'
      if (status === 429) return 'User export verification is being rate-limited right now. Please wait a moment and try again.'
      if (status >= 500) return 'The user export could not be prepared right now. Please try again shortly.'
      return 'The user export could not be prepared right now. Refresh and try again.'
    }

    if (action === 'download') {
      if (status === 401) return 'Please sign in to export users.'
      if (status === 403) return 'Admin access is limited to platform admins.'
      if (status === 408) return 'The export request took too long. Please try again.'
      if (status === 429) return 'User export is being rate-limited right now. Please wait a moment and try again.'
      if (status >= 500) return 'The user export could not be downloaded right now. Please try again shortly.'
      return 'The user export could not be downloaded right now. Refresh and try again.'
    }

    if (status === 401) return 'Please sign in to export users.'
    if (status === 403) return 'Admin access is limited to platform admins.'
    if (status === 408) return 'The user export request took too long. Please try again.'
    if (status === 429) return 'User export is being rate-limited right now. Please wait a moment and try again.'
    if (status >= 500) return 'The user export could not be completed right now. Please try again shortly.'
    return 'The user export could not be completed right now. Refresh and try again.'
  }

  return undefined
}

function getAdminExportNetworkMessage() {
  return 'The export service could not be reached right now. Please try again.'
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
  try {
    const session = await getSafeSession()
    return session?.access_token ?? null
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Unable to read the current session.'
    throw new HidApiError(401, sanitizeAdminDashboardMessage(rawMessage, 401), error)
  }
}

function requireSupabaseFunctionUrl(name: string) {
  return `${requireSupabaseUrl()}/functions/v1/${name}`
}

async function fetchWithTimeoutMs(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 120000,
  timeoutMessage = 'The export request took too long. Please try again.',
) {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort(new Error(timeoutMessage))
  }, timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

function getCachedUserSearch(query: string) {
  const cached = userSearchCache.get(query)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }
  if (cached) {
    userSearchCache.delete(query)
  }
  return null
}

function buildAdminRequestInit(init: RequestInit, accessToken: string): RequestInit {
  const headers = new Headers(init.headers ?? undefined)
  headers.set('Authorization', `Bearer ${accessToken}`)
  headers.set('apikey', requireSupabaseAnonKey())
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return {
    ...init,
    cache: 'no-store',
    headers,
  }
}

export function invalidateAdminDashboardCaches() {
  overviewCache.clear()
  inflightOverviewRequests.clear()
  userSearchCache.clear()
  inflightUserSearchRequests.clear()
  deletedUserCache.clear()
  inflightDeletedUserRequests.clear()
  roleManagementCache.clear()
  inflightRoleManagementRequest.clear()
  platformControlsCache.clear()
  inflightPlatformControlsRequest.clear()
}

async function callAdminUserManagement<T>(path: string, init: RequestInit, statusFallback: number) {
  const accessToken = await getAccessToken()
  if (!accessToken) {
    throw new HidApiError(401, 'Please sign in to continue.')
  }

  let response: Response
  try {
    response = await fetchWithTimeout(path, buildAdminRequestInit(init, accessToken))
  } catch (error) {
    if (path.includes('admin-user-export')) {
      if (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('too long') || error.message.toLowerCase().includes('timed out'))) {
        throw new HidApiError(408, 'The export request took too long. Please try again.', error)
      }
      throw new HidApiError(statusFallback, getAdminExportNetworkMessage(), error)
    }
    if (error instanceof Error && error.message.toLowerCase().includes('too long')) {
      throw new HidApiError(408, NETWORK_TIMEOUT_MESSAGE, error)
    }
    throw error
  }

  const rawBody = await response.text()
  let parsedPayload = null as
    | (EdgeEnvelope<T> & { error?: string; details?: unknown })
    | { error?: string; details?: unknown }
    | null

  if (rawBody) {
    try {
      parsedPayload = JSON.parse(rawBody) as
        | (EdgeEnvelope<T> & { error?: string; details?: unknown })
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
    const fallbackMessage = getAdminEndpointFallbackMessage(path, init, response.status || statusFallback)
    const message = sanitizeAdminDashboardMessage(rawMessage || fallbackErrorMessage('', statusFallback, fallbackMessage), response.status || statusFallback, fallbackMessage)

    if (response.status === 401 || message.toLowerCase().includes('please sign in again')) {
      try {
        await safeSignOut()
      } catch {
        // Best effort only.
      }
      clearAllPortalSessions()
    }

    throw new HidApiError(
      response.status || statusFallback,
      message,
      parsedPayload && typeof parsedPayload === 'object' && 'details' in parsedPayload ? parsedPayload.details : rawBody || parsedPayload
    )
  }

  if (parsedPayload && typeof parsedPayload === 'object' && 'data' in parsedPayload) {
    return parsedPayload.data
  }

  throw new HidApiError(statusFallback, 'Admin controls returned an unexpected response.')
}

export async function fetchAdminDashboardOverview(window: AdminOverviewWindow = '7d', options: { date?: string | null; force?: boolean } = {}) {
  const cacheKey = overviewCacheKey(window, options.date)
  const cached = overviewCache.get(cacheKey)
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const existingRequest = inflightOverviewRequests.get(cacheKey)
  if (existingRequest) {
    return existingRequest
  }

  const request = (async () => {
    const accessToken = await getAccessToken()
    if (!accessToken) {
      throw new HidApiError(401, 'Please sign in to continue.')
    }

    const url = new URL(`${requireSupabaseUrl()}/functions/v1/admin-dashboard-overview`)
    url.searchParams.set('window', window)
    if (options.date?.trim()) {
      url.searchParams.set('date', options.date.trim())
    }
    if (options.force) {
      url.searchParams.set('_ts', `${Date.now()}`)
    }

    let response: Response
    try {
      response = await fetchWithTimeout(url.toString(), {
        cache: 'no-store',
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
        ? sanitizeAdminDashboardMessage(rawMessage, response.status)
        : sanitizeAdminDashboardMessage(rawMessage, response.status)

      if (response.status === 401 || message.toLowerCase().includes('please sign in again')) {
        try {
          await safeSignOut()
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
      overviewCache.set(cacheKey, {
        expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS,
        value: parsedPayload.data,
      })
      return parsedPayload.data
    }

    throw new HidApiError(500, 'Admin dashboard returned an unexpected response.')
  })()

  inflightOverviewRequests.set(cacheKey, request)

  try {
    return await request
  } finally {
    if (inflightOverviewRequests.get(cacheKey) === request) {
      inflightOverviewRequests.delete(cacheKey)
    }
  }
}

async function callAdminUserExport(path: string, init: RequestInit, statusFallback: number) {
  const accessToken = await getAccessToken()
  if (!accessToken) {
    throw new HidApiError(401, 'Please sign in to continue.')
  }

  let response: Response
  try {
    response = await fetchWithTimeoutMs(path, buildAdminRequestInit(init, accessToken))
  } catch (error) {
    if (path.includes('admin-user-export')) {
      if (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('too long') || error.message.toLowerCase().includes('timed out'))) {
        throw new HidApiError(408, 'The export request took too long. Please try again.', error)
      }
      throw new HidApiError(statusFallback, getAdminExportNetworkMessage(), error)
    }
    const rawMessage = error instanceof Error ? error.message : 'The export request could not be completed right now.'
    throw new HidApiError(statusFallback, sanitizeAdminDashboardMessage(rawMessage, statusFallback, getAdminEndpointFallbackMessage(path, init, statusFallback)), error)
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const rawMessage = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error?: unknown }).error ?? '')
      : response.statusText || 'Request failed.'
    throw new HidApiError(response.status, sanitizeAdminDashboardMessage(rawMessage, response.status, getAdminEndpointFallbackMessage(path, init, response.status)), payload)
  }

  return response
}

export async function searchAdminUsers(query: string, options: { force?: boolean } = {}) {
  const trimmed = query.trim()
  if (!trimmed) {
    return [] as AdminManagedUser[]
  }

  const cacheKey = trimmed.toLowerCase()
  if (!options.force) {
    const cached = getCachedUserSearch(cacheKey)
    if (cached) {
      return cached
    }
  }

  const existingRequest = inflightUserSearchRequests.get(cacheKey)
  if (existingRequest) {
    return existingRequest
  }

  const request = (async () => {
    const url = new URL(requireSupabaseFunctionUrl('admin-user-management'))
    url.searchParams.set('query', trimmed)
    const data = await callAdminUserManagement<AdminUserDirectoryResponse>(url.toString(), {
      method: 'GET',
    }, 500)

    const matches = data.matches ?? []
    userSearchCache.set(cacheKey, {
      expiresAt: Date.now() + USER_SEARCH_CACHE_TTL_MS,
      value: matches,
    })
    return matches
  })()

  inflightUserSearchRequests.set(cacheKey, request)

  try {
    return await request
  } finally {
    if (inflightUserSearchRequests.get(cacheKey) === request) {
      inflightUserSearchRequests.delete(cacheKey)
    }
  }
}

export async function fetchDeletedAdminUsers(options: { force?: boolean } = {}) {
  const cacheKey = 'deleted'
  if (!options.force) {
    const cached = deletedUserCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }
    if (cached) {
      deletedUserCache.delete(cacheKey)
    }
  }

  const existingRequest = inflightDeletedUserRequests.get(cacheKey)
  if (existingRequest) {
    return existingRequest
  }

  const request = (async () => {
    const url = new URL(requireSupabaseFunctionUrl('admin-user-management'))
    url.searchParams.set('deleted', '1')
    const data = await callAdminUserManagement<AdminUserDirectoryResponse>(url.toString(), {
      method: 'GET',
    }, 500)

    const matches = data.matches ?? []
    deletedUserCache.set(cacheKey, {
      expiresAt: Date.now() + USER_SEARCH_CACHE_TTL_MS,
      value: matches,
    })
    return matches
  })()

  inflightDeletedUserRequests.set(cacheKey, request)

  try {
    return await request
  } finally {
    if (inflightDeletedUserRequests.get(cacheKey) === request) {
      inflightDeletedUserRequests.delete(cacheKey)
    }
  }
}

export async function applyAdminUserAction(targetAuthUserId: string, action: AdminUserManagementAction) {
  const data = await callAdminUserManagement<AdminUserActionResponse>(requireSupabaseFunctionUrl('admin-user-management'), {
    method: 'POST',
    body: JSON.stringify({
      action,
      targetAuthUserId,
    }),
  }, 500)

  invalidateAdminDashboardCaches()
  return data
}

export async function fetchAdminRoleManagement(options: { force?: boolean } = {}) {
  const cacheKey = 'role-management'
  if (!options.force) {
    const cached = roleManagementCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }
    if (cached) {
      roleManagementCache.delete(cacheKey)
    }
  }

  const existingRequest = inflightRoleManagementRequest.get(cacheKey)
  if (existingRequest) {
    return existingRequest
  }

  const request = (async () => {
    const data = await callAdminUserManagement<AdminRoleManagementResponse>(requireSupabaseFunctionUrl('admin-role-management'), {
      method: 'GET',
    }, 500)

    roleManagementCache.set(cacheKey, {
      expiresAt: Date.now() + ADMIN_CONTROLS_CACHE_TTL_MS,
      value: data,
    })
    return data
  })()

  inflightRoleManagementRequest.set(cacheKey, request)

  try {
    return await request
  } finally {
    if (inflightRoleManagementRequest.get(cacheKey) === request) {
      inflightRoleManagementRequest.delete(cacheKey)
    }
  }
}

export async function createPlatformAdmin(email: string, fullName: string) {
  const data = await callAdminUserManagement<AdminCreatePlatformAdminResponse>(requireSupabaseFunctionUrl('admin-role-management'), {
    method: 'POST',
    body: JSON.stringify({
      action: 'create_admin',
      email,
      fullName,
    }),
  }, 500)

  invalidateAdminDashboardCaches()
  return data
}

export async function startAdminUsersExport(params: {
  format: AdminUsersExportFormat
  filters: AdminUsersExportFilters
}) {
  const data = await callAdminUserManagement<AdminUsersExportStartResponse>(requireSupabaseFunctionUrl('admin-user-export'), {
    method: 'POST',
    body: JSON.stringify({
      action: 'start',
      format: params.format,
      filters: params.filters,
    }),
  }, 500)

  return data
}

export async function downloadAdminUsersExport(params: {
  challengeId: string
  code: string
  format: AdminUsersExportFormat
}) {
  const response = await callAdminUserExport(requireSupabaseFunctionUrl('admin-user-export'), {
    method: 'POST',
    body: JSON.stringify({
      action: 'download',
      challengeId: params.challengeId,
      code: params.code,
      format: params.format,
    }),
  }, 500)

  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const fileNameMatch = /filename="([^"]+)"/i.exec(disposition)
  const fileName = fileNameMatch?.[1] ?? `hid-users-export.${params.format}`
  const mimeType = response.headers.get('content-type') ?? 'application/octet-stream'

  return {
    blob,
    fileName,
    mimeType,
  }
}

export async function updateAdminStaffRolePolicy(
  role: string,
  changes: Partial<Pick<AdminStaffRolePolicy, 'canOpenDashboard' | 'canUseStandardAccess' | 'canViewPatientRecords' | 'canCreateRecords' | 'canUseBreakGlass' | 'canViewHistory'>>,
) {
  const data = await callAdminUserManagement<{ policy: AdminStaffRolePolicy }>(requireSupabaseFunctionUrl('admin-role-management'), {
    method: 'POST',
    body: JSON.stringify({
      action: 'update_staff_role_policy',
      role,
      changes: {
        can_open_dashboard: changes.canOpenDashboard,
        can_use_standard_access: changes.canUseStandardAccess,
        can_view_patient_records: changes.canViewPatientRecords,
        can_create_records: changes.canCreateRecords,
        can_use_break_glass: changes.canUseBreakGlass,
        can_view_history: changes.canViewHistory,
      },
    }),
  }, 500)

  invalidateAdminDashboardCaches()
  return data.policy
}

export async function updateAdminOutreachRolePolicy(
  role: string,
  changes: Partial<Pick<AdminOutreachRolePolicy, 'canOpenWorkspace' | 'canCreateEncounters' | 'canManageInvites' | 'canSyncData' | 'canViewCampaignData'>>,
) {
  const data = await callAdminUserManagement<{ policy: AdminOutreachRolePolicy }>(requireSupabaseFunctionUrl('admin-role-management'), {
    method: 'POST',
    body: JSON.stringify({
      action: 'update_outreach_role_policy',
      role,
      changes: {
        can_open_workspace: changes.canOpenWorkspace,
        can_create_encounters: changes.canCreateEncounters,
        can_manage_invites: changes.canManageInvites,
        can_sync_data: changes.canSyncData,
        can_view_campaign_data: changes.canViewCampaignData,
      },
    }),
  }, 500)

  invalidateAdminDashboardCaches()
  return data.policy
}

export async function fetchAdminPlatformControls(options: { force?: boolean } = {}) {
  const cacheKey = 'platform-controls'
  if (!options.force) {
    const cached = platformControlsCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }
    if (cached) {
      platformControlsCache.delete(cacheKey)
    }
  }

  const existingRequest = inflightPlatformControlsRequest.get(cacheKey)
  if (existingRequest) {
    return existingRequest
  }

  const request = (async () => {
    const data = await callAdminUserManagement<AdminPlatformControlsResponse>(requireSupabaseFunctionUrl('admin-platform-controls'), {
      method: 'GET',
    }, 500)

    platformControlsCache.set(cacheKey, {
      expiresAt: Date.now() + ADMIN_CONTROLS_CACHE_TTL_MS,
      value: data.controls,
    })
    return data.controls
  })()

  inflightPlatformControlsRequest.set(cacheKey, request)

  try {
    return await request
  } finally {
    if (inflightPlatformControlsRequest.get(cacheKey) === request) {
      inflightPlatformControlsRequest.delete(cacheKey)
    }
  }
}

export async function updateAdminPlatformControls(
  controls: Partial<Pick<AdminPlatformControls, 'maintenanceMode' | 'patientSignupEnabled' | 'hospitalSignupEnabled' | 'patientPortalEnabled' | 'hospitalPortalEnabled' | 'outreachSignupEnabled' | 'outreachPortalEnabled' | 'breakGlassEnabled' | 'uploadsEnabled'>>,
) {
  const data = await callAdminUserManagement<AdminPlatformControlsResponse>(requireSupabaseFunctionUrl('admin-platform-controls'), {
    method: 'POST',
    body: JSON.stringify({
      action: 'update_controls',
      controls: {
        maintenance_mode: controls.maintenanceMode,
        patient_signup_enabled: controls.patientSignupEnabled,
        hospital_signup_enabled: controls.hospitalSignupEnabled,
        patient_portal_enabled: controls.patientPortalEnabled,
        hospital_portal_enabled: controls.hospitalPortalEnabled,
        outreach_signup_enabled: controls.outreachSignupEnabled,
        outreach_portal_enabled: controls.outreachPortalEnabled,
        break_glass_enabled: controls.breakGlassEnabled,
        uploads_enabled: controls.uploadsEnabled,
      },
    }),
  }, 500)

  invalidateAdminDashboardCaches()
  return data.controls
}
