import { resolveCorsHeaders } from './cors.ts'

const BANNED_ACCOUNT_MESSAGE = 'This user is banned. Contact: support@healthidentitydirectory.com'

export class HttpError extends Error {
  status: number
  details?: unknown
  code?: string
  headers?: HeadersInit

  constructor(
    status: number,
    message: string,
    details?: unknown,
    options: { code?: string; headers?: HeadersInit } = {},
  ) {
    super(message)
    this.status = status
    this.details = details
    this.code = options.code
    this.headers = options.headers
  }
}

type CacheHeaderOptions = {
  maxAgeSeconds: number
  staleWhileRevalidateSeconds?: number
  scope?: 'private' | 'public'
  varyAuthorization?: boolean
}

function appendHeaders(target: Headers, source?: HeadersInit) {
  if (!source) return

  if (source instanceof Headers) {
    source.forEach((value, key) => {
      target.set(key, value)
    })
    return
  }

  if (Array.isArray(source)) {
    source.forEach(([key, value]) => {
      target.set(key, value)
    })
    return
  }

  Object.entries(source).forEach(([key, value]) => {
    target.set(key, value)
  })
}

function resolveRequestId(req: Request) {
  const provided = req.headers.get('x-request-id')?.trim() ?? ''
  if (/^[a-zA-Z0-9._:-]{8,128}$/.test(provided)) return provided
  return `hid_${crypto.randomUUID()}`
}

function responseTimeMs(startedAt: number) {
  return Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10)
}

function withResponseMetadata(response: Response, req: Request, requestId: string, startedAt: number) {
  const headers = new Headers(response.headers)
  const corsHeaders = resolveCorsHeaders(req.headers.get('Origin'))
  const durationMs = responseTimeMs(startedAt)

  Object.entries(corsHeaders).forEach(([key, value]) => {
    headers.set(key, value)
  })

  headers.set('X-Request-ID', requestId)
  headers.set('X-Response-Time-Ms', `${durationMs}`)
  headers.set('Server-Timing', `app;dur=${durationMs}`)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')

  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'no-store, max-age=0')
  }
  if (headers.get('Cache-Control')?.includes('no-store')) {
    headers.set('Pragma', 'no-cache')
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function handleOptions(req: Request, requestId = resolveRequestId(req), startedAt = performance.now()) {
  if (req.method === 'OPTIONS') {
    return withResponseMetadata(new Response(null, { status: 204 }), req, requestId, startedAt)
  }

  return null
}

export function json(data: unknown, status = 200, headersOverride?: HeadersInit) {
  const headers = new Headers({
    ...resolveCorsHeaders(null),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  appendHeaders(headers, headersOverride)

  return new Response(JSON.stringify(data), {
    status,
    headers,
  })
}

export function buildCacheHeaders(options: CacheHeaderOptions, headersOverride?: HeadersInit) {
  const scope = options.scope ?? 'private'
  const directives = [`${scope}`, `max-age=${Math.max(0, Math.trunc(options.maxAgeSeconds))}`]
  const staleWhileRevalidateSeconds = Math.max(0, Math.trunc(options.staleWhileRevalidateSeconds ?? 0))

  if (staleWhileRevalidateSeconds > 0) {
    directives.push(`stale-while-revalidate=${staleWhileRevalidateSeconds}`)
  }

  const headers = new Headers({
    'Cache-Control': directives.join(', '),
  })

  if (options.varyAuthorization !== false) {
    headers.set('Vary', 'Authorization')
  }

  appendHeaders(headers, headersOverride)
  return headers
}

export async function readJson<T>(req: Request): Promise<T> {
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > 1_048_576) {
    throw new HttpError(413, 'Request body is too large.', null, { code: 'PAYLOAD_TOO_LARGE' })
  }

  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType && !contentType.includes('application/json')) {
    throw new HttpError(415, 'Request body must use JSON.', null, { code: 'UNSUPPORTED_MEDIA_TYPE' })
  }

  try {
    return await req.json() as T
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.', null, { code: 'INVALID_JSON' })
  }
}

export async function withErrorHandling(req: Request, handler: () => Promise<Response> | Response) {
  const startedAt = performance.now()
  const requestId = resolveRequestId(req)
  const preflight = handleOptions(req, requestId, startedAt)
  if (preflight) return preflight

  const requestUrl = new URL(req.url)

  try {
    const response = await handler()
    return withResponseMetadata(response, req, requestId, startedAt)
  } catch (error) {
    if (error instanceof HttpError) {
      const status = normalizeErrorStatus(error.status, error.details)
      const safeMessage = sanitizeErrorMessage(error.message, status)
      const code = error.code ?? errorCodeForStatus(status)
      const retryable = isRetryableStatus(status)
      const headers = new Headers(error.headers)
      if (retryable && !headers.has('Retry-After')) {
        headers.set('Retry-After', status === 429 ? '30' : '15')
      }
      console.error(JSON.stringify({
        code,
        duration_ms: responseTimeMs(startedAt),
        level: status >= 500 ? 'error' : 'warn',
        method: req.method,
        message: error.message,
        path: requestUrl.pathname,
        request_id: requestId,
        status,
      }))
      return withResponseMetadata(json({
        code,
        details: null,
        error: safeMessage,
        message: safeMessage,
        requestId,
        retryable,
        status,
      }, status, headers), req, requestId, startedAt)
    }

    const message = error instanceof Error ? error.message : 'Unexpected server error.'
    const safeMessage = sanitizeErrorMessage(message, 500)
    console.error(JSON.stringify({
      code: 'INTERNAL_ERROR',
      duration_ms: responseTimeMs(startedAt),
      level: 'error',
      method: req.method,
      message,
      path: requestUrl.pathname,
      request_id: requestId,
      stack: error instanceof Error ? error.stack : null,
    }))
    return withResponseMetadata(json({
      code: 'INTERNAL_ERROR',
      details: null,
      error: safeMessage,
      message: safeMessage,
      requestId,
      retryable: true,
      status: 500,
    }, 500, { 'Retry-After': '15' }), req, requestId, startedAt)
  }
}

function errorCodeFromDetails(details: unknown) {
  if (!details || typeof details !== 'object') return null
  const candidate = details as Record<string, unknown>
  if (typeof candidate.code === 'string') return candidate.code.toUpperCase()
  if (candidate.error && typeof candidate.error === 'object') {
    const nestedCode = (candidate.error as Record<string, unknown>).code
    if (typeof nestedCode === 'string') return nestedCode.toUpperCase()
  }
  return null
}

function normalizeErrorStatus(status: number, details: unknown) {
  const detailCode = errorCodeFromDetails(details)
  if (!detailCode || status !== 400) return status

  if (['23503', '23505', '23P01'].includes(detailCode)) return 409
  if (['22P02', '22001', '23502', '23514'].includes(detailCode)) return 422
  if (detailCode === '42501') return 403
  if (detailCode === '57014') return 408
  if (detailCode === 'PGRST116') return 404
  return status
}

function errorCodeForStatus(status: number) {
  if (status === 400) return 'INVALID_REQUEST'
  if (status === 401) return 'AUTH_REQUIRED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 405) return 'METHOD_NOT_ALLOWED'
  if (status === 408) return 'REQUEST_TIMEOUT'
  if (status === 409) return 'CONFLICT'
  if (status === 413) return 'PAYLOAD_TOO_LARGE'
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE'
  if (status === 422) return 'VALIDATION_ERROR'
  if (status === 429) return 'RATE_LIMITED'
  if (status === 502) return 'UPSTREAM_ERROR'
  if (status === 503) return 'SERVICE_UNAVAILABLE'
  if (status === 504) return 'UPSTREAM_TIMEOUT'
  if (status >= 500) return 'INTERNAL_ERROR'
  return 'REQUEST_FAILED'
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function fallbackErrorMessageForStatus(status: number) {
  if (status === 400 || status === 422) return 'Some information is missing or not in the right format. Review it and try again.'
  if (status === 401) return 'Please sign in to continue.'
  if (status === 403) return 'This account is not allowed to do that right now.'
  if (status === 404) return 'We could not find the information you requested.'
  if (status === 405) return 'That request method is not supported.'
  if (status === 408) return 'The request took too long to finish. Please try again.'
  if (status === 409) return 'This action conflicts with existing information. Review the details and try again.'
  if (status === 413) return 'The information sent is too large. Reduce it and try again.'
  if (status === 415) return 'The request format is not supported.'
  if (status === 429) return 'Too many requests were made too quickly. Please wait a moment and try again.'
  if (status >= 500) return 'This service is temporarily unavailable right now. Please try again shortly.'
  return 'That action could not be completed right now. Please try again.'
}

function isLowSignalErrorMessage(lower: string) {
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

function isTechnicalErrorMessage(lower: string, raw: string) {
  return (
    lower.includes('stack') ||
    lower.includes('trace') ||
    lower.includes('sqlstate') ||
    lower.includes('schema') ||
    lower.includes('relation') ||
    lower.includes('constraint') ||
    lower.includes('postgres') ||
    lower.includes('supabase') ||
    lower.includes('jwt') ||
    lower.includes('refresh token') ||
    lower.includes('rpc') ||
    lower.includes('deno') ||
    lower.includes('referenceerror') ||
    lower.includes('typeerror') ||
    lower.includes('syntaxerror') ||
    lower.includes('column reference') ||
    lower.includes('ambiguous') ||
    lower.includes('stack depth') ||
    lower.includes('recursion') ||
    lower.includes('violates row-level security') ||
    lower.includes('permission denied for relation') ||
    raw.includes('/home/') ||
    raw.includes('<!DOCTYPE') ||
    raw.includes('<html')
  )
}

function sanitizeErrorMessage(message: string, status: number) {
  const raw = `${message ?? ''}`.replace(/\s+/g, ' ').trim()
  const lower = raw.toLowerCase()

  if (!raw) {
    return fallbackErrorMessageForStatus(status)
  }

  if (lower.includes('hid code or access pin')) {
    return 'The HID code or access PIN is not correct.'
  }
  if (lower.includes('invalid credentials') || lower.includes('sign-in details')) {
    return 'The sign-in details are not correct.'
  }
  if (lower.includes('user is banned') || lower.includes('banned until')) {
    return BANNED_ACCOUNT_MESSAGE
  }
  if (lower.includes('authentication required') || lower.includes('missing authorization header')) {
    return 'Please sign in to continue.'
  }
  if (
    lower.includes('permission') ||
    lower.includes('only staff can request access') ||
    lower.includes('no active staff membership') ||
    lower.includes('staff profile not found')
  ) {
    return 'This account cannot perform that action right now.'
  }
  if (lower.includes('patient account has been deleted')) {
    return 'This patient account has been deleted and can no longer be opened by a hospital.'
  }
  if (lower.includes('account has been deleted')) {
    return 'This account has been deleted and is no longer available.'
  }
  if (lower.includes('patient account is locked')) {
    return 'This patient account is locked right now and cannot be opened by a hospital.'
  }
  if (lower.includes('account is inactive') || lower.includes('account is not active') || lower.includes('account is locked')) {
    return 'This account is locked right now. Contact support if you need help.'
  }
  if (lower.includes('patient profile already exists')) {
    return 'The information has already been used, Try to sign in.'
  }
  if (lower.includes('email address is already linked to an hid account')) {
    return 'The information has already been used, Try to sign in.'
  }
  if (lower.includes('phone number is already linked to another hid account')) {
    return 'The information has already been used, Try to sign in.'
  }
  if (lower.includes('email address and phone number are already linked')) {
    return 'The information has already been used, Try to sign in.'
  }
  if (lower.includes('already linked to a patient account')) {
    return 'The information has already been used, Try to sign in.'
  }
  if (lower.includes('cannot be used for a hospital account')) {
    return 'This email address cannot be used for a hospital account. Use a different email address.'
  }
  if (lower.includes('no active staff invite was found for this account')) {
    return 'This hospital account is not ready yet. Sign up again with the same email or sign in to continue setup.'
  }
  if (lower.includes('hospital account setup is incomplete')) {
    return 'This hospital account still needs setup. Sign in again or retry signup with the same email.'
  }
  if (lower.includes('hospital account is still finishing setup') || lower.includes('staff onboarding could not be completed')) {
    return 'Your hospital account is still finishing setup. Sign in again in a moment.'
  }
  if (lower.includes('request body must be valid json')) {
    return 'Some information could not be sent correctly. Please try again.'
  }
  if (lower.includes('complete the security check to continue')) {
    return 'Complete the security check before continuing.'
  }
  if (
    (lower.includes('unable to send') && lower.includes('verification code')) ||
    lower.includes('unable to send auth email')
  ) {
    return 'We could not send the verification code right now. Please try again.'
  }
  if (
    lower.includes('duplicate key') ||
    lower.includes('idx_hid_patients_phone') ||
    lower.includes('idx_hid_patients_email')
  ) {
    return 'The information has already been used, Try to sign in.'
  }
  if (
    lower.includes('column reference') ||
    lower.includes('ambiguous') ||
    lower.includes('stack depth') ||
    lower.includes('recursion') ||
    lower.includes('schema cache') ||
    lower.includes('violates row-level security') ||
    lower.includes('permission denied for relation')
  ) {
    return 'This service is temporarily unavailable right now. Please try again shortly.'
  }
  if (
    lower.includes('jwt') ||
    lower.includes('refresh token') ||
    lower.includes('token is expired') ||
    lower.includes('token has expired') ||
    lower.includes('invalid claim') ||
    lower.includes('invalid token')
  ) {
    return 'Please sign in again to continue.'
  }
  if (lower.includes('patient was not found') || lower.includes('no patient account was found')) {
    return 'The details provided could not be verified.'
  }
  if (lower.includes('access pin must be 4 to 8 digits')) {
    return 'Access PIN must be 4 to 8 digits.'
  }
  if (lower.includes('unable to save the patient profile') || lower.includes('save that profile information')) {
    return 'We could not save those profile changes right now. Review the email address and phone number, then try again.'
  }
  if (isLowSignalErrorMessage(lower) || isTechnicalErrorMessage(lower, raw)) {
    return fallbackErrorMessageForStatus(status)
  }
  if (status >= 500) {
    return fallbackErrorMessageForStatus(status)
  }

  return raw
}
