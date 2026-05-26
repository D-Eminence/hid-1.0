import { createAdminClient } from '../_shared/auth.ts'
import { requireEnv } from '../_shared/env.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { resolvePatientAuthIdentity } from '../_shared/patient-identifiers.ts'
import { loadPlatformControls } from '../_shared/platform.ts'
import { verifyTurnstileToken } from '../_shared/turnstile.ts'
import { asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  identifier: string
  password: string
  turnstileToken?: string | null
}

const supabaseUrl = requireEnv('SUPABASE_URL')
const supabaseAnonKey = requireEnv('SUPABASE_ANON_KEY')

function looksLikeEmailIdentifier(value: string) {
  return /\S+@\S+\.\S+/.test(value.trim())
}

function authErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'The sign-in details are not correct.'

  const candidate = payload as Record<string, unknown>
  if (typeof candidate.msg === 'string' && candidate.msg.trim()) return candidate.msg
  if (typeof candidate.error_description === 'string' && candidate.error_description.trim()) return candidate.error_description
  if (typeof candidate.error === 'string' && candidate.error.trim()) return candidate.error

  return 'The sign-in details are not correct.'
}

async function authenticateWithCredential(credentialBody: { email: string; password: string } | { phone: string; password: string }) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentialBody),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.access_token || !data?.refresh_token) {
    throw new HttpError(401, authErrorMessage(data))
  }

  return data
}

async function authenticateWithPassword(
  identity: {
    authEmail?: string | null
    authPhone?: string | null
    email?: string | null
    phone?: string | null
  },
  password: string
) {
  const authEmail = identity.authEmail?.trim().toLowerCase() ?? null
  const authPhone = identity.authPhone?.trim() ?? null
  const credentialBody = authEmail
    ? { email: authEmail, password }
    : authPhone
    ? { phone: authPhone, password }
    : identity.email
    ? { email: identity.email, password }
    : identity.phone
    ? { phone: identity.phone, password }
    : null

  if (!credentialBody) {
    throw new HttpError(401, 'The sign-in details are not correct.')
  }

  return authenticateWithCredential(credentialBody)
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const identifier = asTrimmedString(body.identifier, 'identifier')
  const password = asTrimmedString(body.password, 'password')
  await verifyTurnstileToken(req, body.turnstileToken ?? null, 'patient-login')

  const adminClient = createAdminClient()
  const controls = await loadPlatformControls(adminClient)
  if (controls.maintenance_mode) {
    throw new HttpError(503, 'HID is under scheduled maintenance right now. Please try again shortly.')
  }
  if (!controls.patient_portal_enabled) {
    throw new HttpError(503, 'The patient portal is temporarily unavailable right now.')
  }
  const resolvedIdentity = await resolvePatientAuthIdentity(adminClient, identifier)
  if (!resolvedIdentity) {
    if (!looksLikeEmailIdentifier(identifier)) {
      throw new HttpError(401, 'The sign-in details are not correct.')
    }

    const data = await authenticateWithCredential({
      email: identifier.trim().toLowerCase(),
      password,
    })

    return json({
      data: {
        session: {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
          expires_at: data.expires_at,
          token_type: data.token_type,
          user: data.user,
        },
      },
    })
  }

  const data = await authenticateWithPassword({
    authEmail: resolvedIdentity.authEmail,
    authPhone: resolvedIdentity.authPhone,
    phone: resolvedIdentity.phone,
    email: resolvedIdentity.email,
  }, password)

  return json({
    data: {
      session: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        expires_at: data.expires_at,
        token_type: data.token_type,
        user: data.user,
      },
    },
  })
}))
