import { HttpError } from './http.ts'

export function asTrimmedString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required.`)
  }

  return value.trim()
}

export function optionalTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function asPositiveInt(value: unknown, field: string, fallback: number, max = 1440) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, `${field} must be a positive integer.`)
  }

  return Math.min(parsed, max)
}

export function normalizePhone(value: string | null | undefined) {
  if (!value) return null
  const cleaned = value.replace(/[^0-9+]/g, '')
  return cleaned || null
}

export function sanitizeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
}
