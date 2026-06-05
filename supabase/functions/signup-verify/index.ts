import { createAdminClient } from '../_shared/auth.ts'
import { requireEnv } from '../_shared/env.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { consumeSignupChallenge, verifySignupChallenge } from '../_shared/otp.ts'
import { asTrimmedString } from '../_shared/validation.ts'

type AccountType = 'patient' | 'hospital'

type Payload = {
  accountType?: AccountType
  challengeId?: string
  code?: string
  email?: string
  password?: string
}

type PasswordTokenResponse = {
  access_token?: string
  error?: string
  error_description?: string
  expires_at?: number
  expires_in?: number
  refresh_token?: string
  token_type?: string
}

function looksLikeEmail(value: string) {
  return /\S+@\S+\.\S+/.test(value.trim())
}

function challengeTypeFor(accountType: AccountType) {
  return accountType === 'hospital' ? 'hospital_signup' as const : 'patient_signup' as const
}

async function issuePasswordSession(email: string, password: string) {
  const supabaseUrl = requireEnv('SUPABASE_URL')
  const anonKey = requireEnv('SUPABASE_ANON_KEY')
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  })

  const payload = await response.json().catch(() => null) as PasswordTokenResponse | null
  if (!response.ok || !payload?.access_token || !payload.refresh_token) {
    throw new HttpError(401, 'We could not verify those details.', payload)
  }

  return {
    access_token: payload.access_token,
    expires_at: payload.expires_at,
    expires_in: payload.expires_in,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type,
  }
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const accountType: AccountType = body.accountType === 'hospital' ? 'hospital' : 'patient'
  const challengeId = asTrimmedString(body.challengeId, 'challengeId')
  const code = asTrimmedString(body.code, 'code')
  const email = asTrimmedString(body.email, 'email').toLowerCase()
  const password = asTrimmedString(body.password, 'password')

  if (!looksLikeEmail(email)) {
    throw new HttpError(400, 'Enter a valid email address first.')
  }
  if (code.length !== 6) {
    throw new HttpError(400, 'Enter the full 6-digit verification code first.')
  }
  if (password.length < 8) {
    throw new HttpError(400, 'Enter a valid password first.')
  }

  const adminClient = createAdminClient()
  const result = await verifySignupChallenge(adminClient, challengeId, challengeTypeFor(accountType), code)
  const userResult = await adminClient.auth.admin.getUserById(result.challenge.auth_user_id)

  if (userResult.error || !userResult.data.user) {
    throw new HttpError(400, 'This verification session is not valid anymore.', userResult.error)
  }

  const userEmail = userResult.data.user.email?.trim().toLowerCase() ?? ''
  if (userEmail !== email) {
    throw new HttpError(400, 'This verification session is not valid anymore.')
  }

  const updateResult = await adminClient.auth.admin.updateUserById(result.challenge.auth_user_id, {
    email_confirm: true,
    password,
  })

  if (updateResult.error) {
    throw new HttpError(400, updateResult.error.message, updateResult.error)
  }

  await consumeSignupChallenge(adminClient, result.challenge.id)
  const session = await issuePasswordSession(email, password)

  await adminClient.from('hid_audit_events').insert({
    actor_user_id: result.challenge.auth_user_id,
    resource_type: 'auth',
    action: accountType === 'hospital' ? 'hospital_signup_otp_verified' : 'patient_signup_otp_verified',
    reason: 'Signup verification code verified.',
    metadata: {
      challenge_id: challengeId,
    },
  })

  return json({
    data: {
      session,
    },
  })
}))
