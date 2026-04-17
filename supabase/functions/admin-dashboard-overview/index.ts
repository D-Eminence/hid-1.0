import { createAdminClient, requireRole } from '../_shared/auth.ts'
import { optionalEnv } from '../_shared/env.ts'
import { HttpError, json, withErrorHandling } from '../_shared/http.ts'

type OverviewWindow = '24h' | '7d' | '30d'

type MetricPoint = {
  timestamp: string
  value: number
}

type SentryIssue = {
  id: string
  title: string
  culprit: string | null
  count: number
  users: number
  level: string | null
  status: string | null
  lastSeen: string | null
  permalink: string | null
}

const POSTHOG_OTP_STARTED_EVENTS = [
  'patient_signup_pending_verification',
  'hospital_signup_pending_verification',
  'patient_password_reset_requested',
] as const

const POSTHOG_OTP_COMPLETED_EVENTS = [
  'patient_signup_completed',
  'hospital_signup_completed',
  'patient_password_reset_code_verified',
] as const

function toHogQlList(values: readonly string[]) {
  return values.map(value => `'${value.replace(/'/g, "\\'")}'`).join(', ')
}

function normalizeIssueText(...values: Array<string | null | undefined>) {
  return values
    .map(value => (value ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
}

function isIgnoredSentryIssue(issue: SentryIssue) {
  const text = normalizeIssueText(issue.title, issue.culprit, issue.status, issue.level)

  return (
    text.includes('invalid login credentials') ||
    text.includes('lock was stolen by another request') ||
    text.includes('typeerror: load failed') ||
    text.includes('failed to fetch dynamically imported module')
  )
}

const WINDOW_MAP: Record<OverviewWindow, {
  bucket: 'hour' | 'day'
  posthogInterval: string
  sentryStatsPeriod: string
}> = {
  '24h': { bucket: 'hour', posthogInterval: '24 HOUR', sentryStatsPeriod: '24h' },
  '7d': { bucket: 'day', posthogInterval: '7 DAY', sentryStatsPeriod: '7d' },
  '30d': { bucket: 'day', posthogInterval: '30 DAY', sentryStatsPeriod: '30d' },
}

function parseWindow(raw: string | null): OverviewWindow {
  if (raw === '24h' || raw === '7d' || raw === '30d') return raw
  return '7d'
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function getRequiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim()
  return value ? value : null
}

function startOfToday(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function startOfWindow(windowKey: OverviewWindow, now = new Date()) {
  const current = now.getTime()
  const durations = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }
  return new Date(current - durations[windowKey])
}

function parseNumeric(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toTimestamp(value: unknown) {
  if (typeof value === 'string' && value) return value
  if (value instanceof Date) return value.toISOString()
  return new Date().toISOString()
}

function aggregateTimeline(timestamps: string[], windowKey: OverviewWindow): MetricPoint[] {
  const config = WINDOW_MAP[windowKey]
  const buckets = new Map<string, number>()

  timestamps.forEach(timestamp => {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return
    const bucket = config.bucket === 'hour'
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).toISOString()
      : new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString()
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
  })

  return Array.from(buckets.entries())
    .sort(([left], [right]) => new Date(left).getTime() - new Date(right).getTime())
    .map(([timestamp, value]) => ({ timestamp, value }))
}

function buildFunnelStep(label: string, key: string, value: number, previous: number | null) {
  return {
    conversionFromPrevious: previous == null || previous === 0 ? null : (value / previous) * 100,
    key,
    label,
    value,
  }
}

async function fetchJson(url: string, init: RequestInit) {
  const response = await fetch(url, init)
  const text = await response.text()
  let payload: unknown = null

  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'detail' in payload && typeof (payload as Record<string, unknown>).detail === 'string'
      ? (payload as Record<string, string>).detail
      : typeof payload === 'object' && payload && 'error' in payload && typeof (payload as Record<string, unknown>).error === 'string'
        ? (payload as Record<string, string>).error
        : `Provider request failed with status ${response.status}.`
    throw new Error(message)
  }

  return payload
}

function normalizeSentryTrend(input: unknown): MetricPoint[] {
  if (!Array.isArray(input)) return []

  return input.flatMap(item => {
    if (Array.isArray(item)) {
      const [timestamp, value] = item
      if (Array.isArray(value)) {
        const total = value.reduce((sum, entry) => {
          if (entry && typeof entry === 'object') {
            return sum + parseNumeric((entry as Record<string, unknown>).count)
          }
          return sum + parseNumeric(entry)
        }, 0)
        return [{ timestamp: toTimestamp(timestamp), value: total }]
      }
      if (value && typeof value === 'object') {
        return [{ timestamp: toTimestamp(timestamp), value: parseNumeric((value as Record<string, unknown>).count) }]
      }
      return [{ timestamp: toTimestamp(timestamp), value: parseNumeric(value) }]
    }

    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      return [{
        timestamp: toTimestamp(record.timestamp ?? record.time ?? record.name),
        value: parseNumeric(record.count ?? record.value ?? record.total ?? record.received),
      }]
    }

    return []
  }).filter(point => Number.isFinite(point.value))
}

function aggregateTrendSeries(seriesList: MetricPoint[][]) {
  const bucketMap = new Map<string, number>()
  seriesList.flat().forEach(point => {
    bucketMap.set(point.timestamp, (bucketMap.get(point.timestamp) ?? 0) + point.value)
  })
  return Array.from(bucketMap.entries())
    .sort(([left], [right]) => new Date(left).getTime() - new Date(right).getTime())
    .map(([timestamp, value]) => ({ timestamp, value }))
}

function normalizeSentryIssue(input: unknown): SentryIssue | null {
  if (!input || typeof input !== 'object') return null
  const issue = input as Record<string, unknown>
  const id = typeof issue.id === 'string' ? issue.id : null
  const title = typeof issue.title === 'string' ? issue.title : null
  if (!id || !title) return null

  return {
    id,
    title,
    culprit: typeof issue.culprit === 'string' ? issue.culprit : null,
    count: parseNumeric(issue.count),
    users: parseNumeric(issue.userCount),
    level: typeof issue.level === 'string' ? issue.level : null,
    status: typeof issue.status === 'string' ? issue.status : null,
    lastSeen: typeof issue.lastSeen === 'string' ? issue.lastSeen : null,
    permalink: typeof issue.permalink === 'string' ? issue.permalink : null,
  }
}

async function loadSentryOverview(windowKey: OverviewWindow) {
  const authToken = getRequiredSecret('SENTRY_AUTH_TOKEN')
  const orgSlug = getRequiredSecret('SENTRY_ORG_SLUG')
  const projectList = (getRequiredSecret('SENTRY_PROJECT_SLUGS') ?? getRequiredSecret('SENTRY_PROJECT_SLUG') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const baseUrl = trimTrailingSlash(optionalEnv('SENTRY_BASE_URL', 'https://sentry.io'))

  if (!authToken || !orgSlug || projectList.length === 0) {
    return {
      affectedUsers: null,
      configured: false,
      externalUrl: null,
      issueEvents: null,
      message: 'Add SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG, and SENTRY_PROJECT_SLUG to Supabase secrets.',
      projectLabel: null,
      recentIssues: [] as SentryIssue[],
      trend: [] as MetricPoint[],
      unresolvedIssues: null,
    }
  }

  const config = WINDOW_MAP[windowKey]
  const headers = { Authorization: `Bearer ${authToken}` }

  try {
    const results = await Promise.all(projectList.map(async projectSlug => {
      const issues = await fetchJson(
        `${baseUrl}/api/0/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/issues/?query=${encodeURIComponent('is:unresolved')}&limit=5`,
        { headers }
      )
      const since = startOfWindow(windowKey).toISOString()
      const until = new Date().toISOString()
      const stats = await fetchJson(
        `${baseUrl}/api/0/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/stats/?stat=received&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&resolution=${encodeURIComponent(config.bucket === 'hour' ? '1h' : '1d')}`,
        { headers }
      ).catch(() => [])

      return {
        issues: Array.isArray(issues) ? issues.map(normalizeSentryIssue).filter((value): value is SentryIssue => Boolean(value)) : [],
        trend: normalizeSentryTrend(stats),
      }
    }))

    const combinedIssues = results.flatMap(result => result.issues)
      .sort((left, right) => new Date(right.lastSeen ?? 0).getTime() - new Date(left.lastSeen ?? 0).getTime())
    const actionableIssues = combinedIssues.filter(issue => !isIgnoredSentryIssue(issue)).slice(0, 8)

    return {
      affectedUsers: actionableIssues.reduce((sum, issue) => sum + issue.users, 0),
      configured: true,
      externalUrl: `${baseUrl}/organizations/${encodeURIComponent(orgSlug)}/issues/`,
      issueEvents: actionableIssues.reduce((sum, issue) => sum + issue.count, 0),
      message: null,
      projectLabel: projectList.join(', '),
      recentIssues: actionableIssues,
      trend: aggregateTrendSeries(results.map(result => result.trend)),
      unresolvedIssues: actionableIssues.length,
    }
  } catch (error) {
    return {
      affectedUsers: null,
      configured: true,
      externalUrl: `${baseUrl}/organizations/${encodeURIComponent(orgSlug)}/issues/`,
      issueEvents: null,
      message: error instanceof Error ? error.message : 'Unable to load Sentry overview right now.',
      projectLabel: projectList.join(', '),
      recentIssues: [] as SentryIssue[],
      trend: [] as MetricPoint[],
      unresolvedIssues: null,
    }
  }
}

function extractRows(payload: unknown) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.results)) return record.results
    if (Array.isArray(record.result)) return record.result
  }
  return []
}

function getColumns(payload: unknown) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.columns)) {
      return record.columns
        .map(value => (typeof value === 'string' ? value : null))
        .filter((value): value is string => Boolean(value))
    }
  }
  return []
}

function normalizeRows(payload: unknown) {
  const rows = extractRows(payload)
  const columns = getColumns(payload)

  if (columns.length === 0) return rows

  return rows.map(row => {
    if (!Array.isArray(row)) return row

    return columns.reduce<Record<string, unknown>>((record, column, index) => {
      record[column] = row[index] ?? null
      return record
    }, {})
  })
}

function getRowValue(row: unknown, key: string) {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const record = row as Record<string, unknown>
    return record[key]
  }
  return null
}

async function runPosthogQuery(baseUrl: string, projectId: string, apiKey: string, query: string) {
  return fetchJson(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: {
        kind: 'HogQLQuery',
        query,
      },
    }),
  })
}

async function loadPosthogOverview(windowKey: OverviewWindow) {
  const apiKey = getRequiredSecret('POSTHOG_PERSONAL_API_KEY')
  const projectId = getRequiredSecret('POSTHOG_PROJECT_ID')
  const baseUrl = trimTrailingSlash(optionalEnv('POSTHOG_HOST', 'https://us.posthog.com'))

  if (!apiKey || !projectId) {
    return {
      configured: false,
      events: null,
      externalUrl: null,
      message: 'Add POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID to Supabase secrets.',
      otpCompleted: null,
      otpStarted: null,
      projectLabel: null,
      topEvents: [] as Array<{ name: string; total: number }>,
      trend: [] as MetricPoint[],
      uniqueUsers: null,
    }
  }

  const config = WINDOW_MAP[windowKey]
  const bucketExpression = config.bucket === 'hour' ? 'toStartOfHour(timestamp)' : 'toStartOfDay(timestamp)'
  const intervalExpression = `INTERVAL ${config.posthogInterval}`

  try {
    const [eventsResponse, uniqueUsersResponse, topEventsResponse, trendResponse, otpBreakdownResponse] = await Promise.all([
      runPosthogQuery(baseUrl, projectId, apiKey, `SELECT count() AS events FROM events WHERE timestamp >= now() - ${intervalExpression}`),
      runPosthogQuery(baseUrl, projectId, apiKey, `SELECT count(DISTINCT coalesce(person_id, distinct_id)) AS users FROM events WHERE timestamp >= now() - ${intervalExpression}`),
      runPosthogQuery(baseUrl, projectId, apiKey, `SELECT event AS name, count() AS total FROM events WHERE timestamp >= now() - ${intervalExpression} GROUP BY event ORDER BY total DESC LIMIT 8`),
      runPosthogQuery(baseUrl, projectId, apiKey, `SELECT ${bucketExpression} AS bucket, count() AS total FROM events WHERE timestamp >= now() - ${intervalExpression} GROUP BY bucket ORDER BY bucket ASC`),
      runPosthogQuery(
        baseUrl,
        projectId,
        apiKey,
        `SELECT event AS name, count() AS total FROM events WHERE timestamp >= now() - ${intervalExpression} AND event IN (${toHogQlList([...POSTHOG_OTP_STARTED_EVENTS, ...POSTHOG_OTP_COMPLETED_EVENTS])}) GROUP BY event`
      ),
    ])

    const eventRows = normalizeRows(eventsResponse)
    const userRows = normalizeRows(uniqueUsersResponse)
    const topEventRows = normalizeRows(topEventsResponse)
    const trendRows = normalizeRows(trendResponse)
    const otpRows = normalizeRows(otpBreakdownResponse)
    const otpCounts = new Map(otpRows.map(row => [
      String(getRowValue(row, 'name') ?? ''),
      parseNumeric(getRowValue(row, 'total')),
    ]))
    const otpStarted = POSTHOG_OTP_STARTED_EVENTS.reduce((sum, event) => sum + (otpCounts.get(event) ?? 0), 0)
    const otpCompleted = POSTHOG_OTP_COMPLETED_EVENTS.reduce((sum, event) => sum + (otpCounts.get(event) ?? 0), 0)

    return {
      configured: true,
      events: parseNumeric(getRowValue(eventRows[0], 'events')),
      externalUrl: `${baseUrl}/project/${encodeURIComponent(projectId)}/insights`,
      message: null,
      otpCompleted,
      otpStarted,
      projectLabel: `Project ${projectId}`,
      topEvents: topEventRows.map(row => ({
        name: String(getRowValue(row, 'name') ?? 'Unknown event'),
        total: parseNumeric(getRowValue(row, 'total')),
      })),
      trend: trendRows.map(row => ({
        timestamp: toTimestamp(getRowValue(row, 'bucket')),
        value: parseNumeric(getRowValue(row, 'total')),
      })),
      uniqueUsers: parseNumeric(getRowValue(userRows[0], 'users')),
    }
  } catch (error) {
    return {
      configured: true,
      events: null,
      externalUrl: `${baseUrl}/project/${encodeURIComponent(projectId)}/insights`,
      message: error instanceof Error ? error.message : 'Unable to load PostHog overview right now.',
      otpCompleted: null,
      otpStarted: null,
      projectLabel: `Project ${projectId}`,
      topEvents: [] as Array<{ name: string; total: number }>,
      trend: [] as MetricPoint[],
      uniqueUsers: null,
    }
  }
}

async function listAllAuthUsers(adminClient: ReturnType<typeof createAdminClient>) {
  const users: Array<Record<string, unknown>> = []
  let page = 1
  const perPage = 1000

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    })

    if (error) throw new HttpError(400, error.message, error)

    const nextUsers = data.users as Array<Record<string, unknown>>
    users.push(...nextUsers)
    if (nextUsers.length < perPage) break
    page += 1
  }

  return users
}

function isOnOrAfter(timestamp: string | null | undefined, threshold: Date) {
  if (!timestamp) return false
  const time = new Date(timestamp).getTime()
  return Number.isFinite(time) && time >= threshold.getTime()
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')

  await requireRole(req, ['platform_admin'])
  const adminClient = createAdminClient()
  const url = new URL(req.url)
  const windowKey = parseWindow(url.searchParams.get('window'))
  const periodStart = startOfWindow(windowKey)
  const todayStart = startOfToday()

  const authUsersPromise = listAllAuthUsers(adminClient)

  const responseTimeProbe = (async () => {
    const startedAt = Date.now()
    const result = await adminClient.from('hid_user_profiles').select('id', { count: 'exact', head: true }).limit(1)
    return {
      durationMs: Date.now() - startedAt,
      result,
    }
  })()

  const [
    authUsers,
    userProfilesResponse,
    totalRecordsResponse,
    windowRecordsResponse,
    providerRecordCountResponse,
    organizationsCountResponse,
    totalProvidersCountResponse,
    activeProvidersCountResponse,
    recordFilesResponse,
    recentUploadsResponse,
    passwordFailuresResponse,
    mfaFailuresResponse,
    authChallengesResponse,
    breakGlassEventsResponse,
    responseTimeProbeResult,
    sentry,
    posthog,
  ] = await Promise.all([
    authUsersPromise,
    adminClient.from('hid_user_profiles').select('id, auth_user_id, app_role, display_name, created_at'),
    adminClient.from('hid_medical_records').select('id', { count: 'exact', head: true }),
    adminClient.from('hid_medical_records').select('id, patient_id, created_at, created_by_staff_account_id').gte('created_at', periodStart.toISOString()),
    adminClient.from('hid_medical_records').select('id', { count: 'exact', head: true }).not('created_by_staff_account_id', 'is', null),
    adminClient.from('hid_organizations').select('id', { count: 'exact', head: true }),
    adminClient.from('hid_staff_accounts').select('id', { count: 'exact', head: true }),
    adminClient.from('hid_staff_accounts').select('id', { count: 'exact', head: true }).eq('active', true),
    adminClient.from('hid_medical_record_files').select('size_bytes'),
    adminClient.from('hid_medical_record_files').select('id, original_file_name, mime_type, created_at, uploaded_by_user_profile_id, patient_id').order('created_at', { ascending: false }).limit(8),
    adminClient.from('hid_password_failed_verification_attempts').select('user_id, last_failed_at').gte('last_failed_at', periodStart.toISOString()),
    adminClient.from('hid_mfa_failed_verification_attempts').select('user_id, last_failed_at').gte('last_failed_at', periodStart.toISOString()),
    adminClient.from('hid_auth_challenges').select('id, created_at, verified_at').gte('created_at', periodStart.toISOString()),
    adminClient.from('hid_audit_events').select('event_id').gte('created_at', periodStart.toISOString()).ilike('action', '%break_glass%'),
    responseTimeProbe,
    loadSentryOverview(windowKey),
    loadPosthogOverview(windowKey),
  ])

  if (userProfilesResponse.error) throw new HttpError(400, userProfilesResponse.error.message, userProfilesResponse.error)
  if (totalRecordsResponse.error) throw new HttpError(400, totalRecordsResponse.error.message, totalRecordsResponse.error)
  if (windowRecordsResponse.error) throw new HttpError(400, windowRecordsResponse.error.message, windowRecordsResponse.error)
  if (providerRecordCountResponse.error) throw new HttpError(400, providerRecordCountResponse.error.message, providerRecordCountResponse.error)
  if (organizationsCountResponse.error) throw new HttpError(400, organizationsCountResponse.error.message, organizationsCountResponse.error)
  if (totalProvidersCountResponse.error) throw new HttpError(400, totalProvidersCountResponse.error.message, totalProvidersCountResponse.error)
  if (activeProvidersCountResponse.error) throw new HttpError(400, activeProvidersCountResponse.error.message, activeProvidersCountResponse.error)
  if (recordFilesResponse.error) throw new HttpError(400, recordFilesResponse.error.message, recordFilesResponse.error)
  if (recentUploadsResponse.error) throw new HttpError(400, recentUploadsResponse.error.message, recentUploadsResponse.error)
  if (passwordFailuresResponse.error) throw new HttpError(400, passwordFailuresResponse.error.message, passwordFailuresResponse.error)
  if (mfaFailuresResponse.error) throw new HttpError(400, mfaFailuresResponse.error.message, mfaFailuresResponse.error)
  if (authChallengesResponse.error) throw new HttpError(400, authChallengesResponse.error.message, authChallengesResponse.error)
  if (breakGlassEventsResponse.error) throw new HttpError(400, breakGlassEventsResponse.error.message, breakGlassEventsResponse.error)
  if (responseTimeProbeResult.result.error) throw new HttpError(400, responseTimeProbeResult.result.error.message, responseTimeProbeResult.result.error)

  const apiResponseTimeMs = responseTimeProbeResult.durationMs
  const totalUsers = authUsers.length
  const verifiedUsers = authUsers.filter(user => Boolean(user.email_confirmed_at ?? user.phone_confirmed_at)).length
  const unverifiedUsers = Math.max(totalUsers - verifiedUsers, 0)
  const newSignupsToday = authUsers.filter(user => isOnOrAfter(user.created_at as string | null, todayStart)).length
  const newSignupsWindow = authUsers.filter(user => isOnOrAfter(user.created_at as string | null, periodStart)).length
  const activeUsers24h = authUsers.filter(user => isOnOrAfter(user.last_sign_in_at as string | null, startOfWindow('24h'))).length
  const activeUsersWindow = authUsers.filter(user => isOnOrAfter(user.last_sign_in_at as string | null, periodStart)).length

  const profileRows = (userProfilesResponse.data ?? []) as Array<Record<string, unknown>>
  const profileByAuthId = new Map(profileRows.map(profile => [
    String(profile.auth_user_id),
    {
      appRole: typeof profile.app_role === 'string' ? profile.app_role : null,
      createdAt: typeof profile.created_at === 'string' ? profile.created_at : null,
      displayName: typeof profile.display_name === 'string' ? profile.display_name : null,
    },
  ]))

  const userGrowth = aggregateTimeline(
    authUsers
      .map(user => typeof user.created_at === 'string' ? user.created_at : null)
      .filter((value): value is string => Boolean(value) && isOnOrAfter(value, periodStart)),
    windowKey
  )

  const recentUsers = authUsers
    .slice()
    .sort((left, right) => new Date(String(right.created_at ?? 0)).getTime() - new Date(String(left.created_at ?? 0)).getTime())
    .slice(0, 8)
    .map(user => {
      const profile = profileByAuthId.get(String(user.id))
      const email = typeof user.email === 'string' ? user.email : null
      const name = profile?.displayName
        ?? (typeof user.user_metadata === 'object' && user.user_metadata && typeof (user.user_metadata as Record<string, unknown>).full_name === 'string'
          ? (user.user_metadata as Record<string, string>).full_name
          : email?.split('@')[0] ?? null)
      return {
        createdAt: String(user.created_at ?? ''),
        email,
        id: String(user.id),
        lastSignInAt: typeof user.last_sign_in_at === 'string' ? user.last_sign_in_at : null,
        name,
        role: profile?.appRole ?? null,
        status: user.email_confirmed_at || user.phone_confirmed_at ? 'verified' as const : 'unverified' as const,
      }
    })

  const windowRecordRows = (windowRecordsResponse.data ?? []) as Array<Record<string, unknown>>
  const recordUploads = aggregateTimeline(
    windowRecordRows
      .map(record => typeof record.created_at === 'string' ? record.created_at : null)
      .filter((value): value is string => Boolean(value)),
    windowKey
  )

  const uploadedToday = windowRecordRows.filter(record => isOnOrAfter(record.created_at as string | null, todayStart)).length
  const averagePerUser = totalUsers === 0 ? 0 : Number(((totalRecordsResponse.count ?? 0) / totalUsers).toFixed(1))
  const storageBytes = ((recordFilesResponse.data ?? []) as Array<Record<string, unknown>>)
    .reduce((sum, file) => sum + parseNumeric(file.size_bytes), 0)

  const recentUploadRows = (recentUploadsResponse.data ?? []) as Array<Record<string, unknown>>
  const uploadProfileIds = Array.from(new Set(recentUploadRows.map(row => row.uploaded_by_user_profile_id).filter(Boolean))) as string[]
  const uploadPatientIds = Array.from(new Set(recentUploadRows.map(row => row.patient_id).filter(Boolean))) as string[]

  const [uploadProfilesResponse, uploadPatientsResponse] = await Promise.all([
    uploadProfileIds.length
      ? adminClient.from('hid_user_profiles').select('id, display_name').in('id', uploadProfileIds)
      : Promise.resolve({ data: [], error: null }),
    uploadPatientIds.length
      ? adminClient.from('hid_patients').select('id, full_name').in('id', uploadPatientIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (uploadProfilesResponse.error) throw new HttpError(400, uploadProfilesResponse.error.message, uploadProfilesResponse.error)
  if (uploadPatientsResponse.error) throw new HttpError(400, uploadPatientsResponse.error.message, uploadPatientsResponse.error)

  const uploadProfileMap = new Map(((uploadProfilesResponse.data ?? []) as Array<Record<string, unknown>>).map(profile => [String(profile.id), String(profile.display_name ?? 'Unknown user')]))
  const uploadPatientMap = new Map(((uploadPatientsResponse.data ?? []) as Array<Record<string, unknown>>).map(patient => [String(patient.id), String(patient.full_name ?? 'Unknown patient')]))

  const recentUploads = recentUploadRows.map(row => ({
    createdAt: String(row.created_at ?? ''),
    fileName: String(row.original_file_name ?? 'Unnamed file'),
    fileType: typeof row.mime_type === 'string' ? row.mime_type : null,
    id: String(row.id),
    uploadedBy: uploadProfileMap.get(String(row.uploaded_by_user_profile_id)) ?? null,
    uploadedFor: uploadPatientMap.get(String(row.patient_id)) ?? null,
  }))

  const passwordFailures = (passwordFailuresResponse.data ?? []) as Array<Record<string, unknown>>
  const mfaFailures = (mfaFailuresResponse.data ?? []) as Array<Record<string, unknown>>
  const failedLoginAttempts = passwordFailures.length + mfaFailures.length
  const breakGlassCount = ((breakGlassEventsResponse.data ?? []) as Array<Record<string, unknown>>).length
  const suspiciousActivityCount = failedLoginAttempts + breakGlassCount

  const challenges = (authChallengesResponse.data ?? []) as Array<Record<string, unknown>>
  const otpCompleted = challenges.filter(challenge => Boolean(challenge.verified_at)).length
  const posthogOtpSuccessRate = posthog.otpStarted && posthog.otpStarted > 0
    ? Number(((Number(posthog.otpCompleted ?? 0) / Number(posthog.otpStarted)) * 100).toFixed(1))
    : null
  const otpSuccessRate = posthogOtpSuccessRate ?? (challenges.length === 0 ? null : Number(((otpCompleted / challenges.length) * 100).toFixed(1)))

  const accountCreated = profileRows.filter(profile => isOnOrAfter(profile.created_at as string | null, periodStart)).length
  const firstRecordUploaded = new Set(windowRecordRows.map(record => String(record.patient_id ?? '')).filter(Boolean)).size
  const funnel = [
    buildFunnelStep('Signup started', 'signup_started', newSignupsWindow, null),
    buildFunnelStep('OTP completed', 'otp_completed', otpCompleted, newSignupsWindow),
    buildFunnelStep('Account created', 'account_created', accountCreated, otpCompleted),
    buildFunnelStep('First record uploaded', 'first_record_uploaded', firstRecordUploaded, accountCreated),
  ]

  const failedRequests = sentry.issueEvents ?? failedLoginAttempts
  const errorRate = sentry.issueEvents != null && posthog.events != null && posthog.events > 0
    ? Number(((sentry.issueEvents / posthog.events) * 100).toFixed(2))
    : null
  const uptimePercent = apiResponseTimeMs > 0 ? 100 : 0

  const alerts = [
    errorRate != null && errorRate >= 5 ? {
      id: 'high-error-rate',
      level: 'critical' as const,
      message: `Observed error rate is ${errorRate.toFixed(2)}% in the selected window. Check Sentry issues before deploy.`,
      title: 'High error rate',
    } : null,
    failedLoginAttempts >= 10 ? {
      id: 'failed-login-spike',
      level: 'warning' as const,
      message: `${failedLoginAttempts} failed login attempts were recorded in the current window.`,
      title: 'Failed login spike',
    } : null,
    otpSuccessRate != null && otpSuccessRate < 70 ? {
      id: 'otp-success-drop',
      level: 'warning' as const,
      message: `OTP success rate is ${otpSuccessRate.toFixed(1)}%. Review delivery reliability and challenge expiry.`,
      title: 'OTP completion dropped',
    } : null,
    apiResponseTimeMs >= 800 ? {
      id: 'slow-api',
      level: 'warning' as const,
      message: `Current API probe took ${apiResponseTimeMs} ms. Monitor Supabase latency before launch.`,
      title: 'Slow API response',
    } : null,
    !sentry.configured || !posthog.configured ? {
      id: 'observability-setup',
      level: 'info' as const,
      message: 'Set the Sentry and PostHog admin secrets to unlock full analytics inside this dashboard.',
      title: 'Observability setup incomplete',
    } : null,
  ].filter((value): value is { id: string; level: 'info' | 'warning' | 'critical'; message: string; title: string } => Boolean(value))

  return json({
    data: {
      alerts,
      checkedAt: new Date().toISOString(),
      posthog,
      providers: {
        activeProviders: activeProvidersCountResponse.count ?? 0,
        recordsUploadedByProviders: providerRecordCountResponse.count ?? 0,
        totalOrganizations: organizationsCountResponse.count ?? 0,
        totalProviders: totalProvidersCountResponse.count ?? 0,
      },
      records: {
        averagePerUser,
        recentUploads,
        storageBytes,
        totalRecords: totalRecordsResponse.count ?? 0,
        uploadedToday,
        uploads: recordUploads,
      },
      security: {
        failedLoginAttempts,
        otpSuccessRate,
        suspiciousActivityCount,
      },
      sentry,
      system: {
        apiResponseTimeMs,
        errorRate,
        failedRequests,
        uptimePercent,
      },
      users: {
        activeUsers24h,
        activeUsersWindow,
        funnel,
        growth: userGrowth,
        newSignupsToday,
        newSignupsWindow,
        recentUsers,
        totalUsers,
        unverifiedUsers,
        verifiedUsers,
      },
      window: windowKey,
    },
  })
}))
