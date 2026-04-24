import { optionalEnv } from './env.ts'
import { HttpError } from './http.ts'

type RecordUploadTokenPayload = {
  v: 1
  authUserId: string
  patientId: string
  profileId: string
  recordId: string
  storageBucket: string
  storagePath: string
  expiresAt: string
}

const TOKEN_VERSION = 1 as const
const DEFAULT_TTL_SECONDS = 10 * 60

function signingSecret() {
  return optionalEnv(
    'HID_RECORD_UPLOAD_TOKEN_SECRET',
    optionalEnv('HID_OTP_PEPPER', 'hid-dev-upload-token-secret'),
  )
}

function encoder() {
  return new TextEncoder()
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll(/=+$/g, '')
}

function fromBase64Url(value: string) {
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

async function importSigningKey() {
  return crypto.subtle.importKey(
    'raw',
    encoder().encode(signingSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function signValue(value: string) {
  const key = await importSigningKey()
  const signature = await crypto.subtle.sign('HMAC', key, encoder().encode(value))
  return toBase64Url(new Uint8Array(signature))
}

async function verifySignature(value: string, signature: string) {
  const key = await importSigningKey()
  return crypto.subtle.verify('HMAC', key, fromBase64Url(signature), encoder().encode(value))
}

export async function createRecordUploadToken(
  payload: Omit<RecordUploadTokenPayload, 'expiresAt' | 'v'>,
  ttlSeconds = DEFAULT_TTL_SECONDS,
) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  const body: RecordUploadTokenPayload = {
    ...payload,
    expiresAt,
    v: TOKEN_VERSION,
  }
  const encodedPayload = toBase64Url(encoder().encode(JSON.stringify(body)))
  const signature = await signValue(encodedPayload)
  return {
    expiresAt,
    token: `${encodedPayload}.${signature}`,
  }
}

export async function verifyRecordUploadToken(token: string) {
  const [encodedPayload, signature] = token.trim().split('.')
  if (!encodedPayload || !signature) {
    throw new HttpError(400, 'Upload authorization is not valid.')
  }

  const signatureValid = await verifySignature(encodedPayload, signature)
  if (!signatureValid) {
    throw new HttpError(400, 'Upload authorization is not valid.')
  }

  let payload: RecordUploadTokenPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as RecordUploadTokenPayload
  } catch {
    throw new HttpError(400, 'Upload authorization is not valid.')
  }

  if (payload.v !== TOKEN_VERSION || !payload.storagePath || !payload.recordId || !payload.profileId || !payload.authUserId) {
    throw new HttpError(400, 'Upload authorization is not valid.')
  }

  if (new Date(payload.expiresAt).getTime() <= Date.now()) {
    throw new HttpError(400, 'Upload authorization has expired. Start the upload again.')
  }

  return payload
}
