const DEFAULT_ALLOWED_ORIGINS = [
  'https://healthidentitydirectory.com',
  'https://www.healthidentitydirectory.com',
  'http://localhost:3000',
]

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function configuredOrigins() {
  const raw = Deno.env.get('HID_ALLOWED_ORIGIN') ?? ''
  const values = raw
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean)

  if (values.length > 0) {
    return new Set(values)
  }

  return new Set(DEFAULT_ALLOWED_ORIGINS)
}

export function resolveCorsHeaders(origin: string | null) {
  const allowedOrigins = configuredOrigins()
  const normalizedOrigin = origin ? normalizeOrigin(origin) : ''
  const allowOrigin = normalizedOrigin && allowedOrigins.has(normalizedOrigin)
    ? normalizedOrigin
    : Array.from(allowedOrigins)[0] ?? '*'

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin',
  }
}
