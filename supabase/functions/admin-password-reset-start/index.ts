import { createAdminClient } from '../_shared/auth.ts'
import { requireEnv } from '../_shared/env.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  email?: string
  turnstileToken?: string | null
}

type AuthSearchRow = {
  auth_user_id: string
  email: string | null
}

type ProfileRow = {
  active: boolean
  app_role: string
  deleted_at: string | null
}

const INVALID_ADMIN_EMAIL_MESSAGE = 'We could not verify those details. Please check the email and try again.'

function isEmail(value: string) {
  return /\S+@\S+\.\S+/.test(value)
}

async function sendAdminOtp(email: string, turnstileToken: string | null | undefined) {
  const response = await fetch(`${requireEnv('SUPABASE_URL')}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      apikey: requireEnv('SUPABASE_ANON_KEY'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      create_user: false,
      gotrue_meta_security: {
        captcha_token: turnstileToken ?? undefined,
      },
    }),
  })

  if (!response.ok) {
    throw new HttpError(response.status >= 500 ? 503 : 400, 'Unable to send a verification code right now.')
  }
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const email = asTrimmedString(body.email, 'email').toLowerCase()
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid admin email address first.')

  const adminClient = createAdminClient()
  const authSearch = await adminClient.rpc('hid_admin_auth_user_search', {
    p_limit: 8,
    p_query: email,
  })
  if (authSearch.error) throw new HttpError(400, 'We could not verify that admin email right now.', authSearch.error)

  const authUser = ((authSearch.data ?? []) as AuthSearchRow[]).find(row => (
    row.auth_user_id && row.email?.trim().toLowerCase() === email
  ))
  if (!authUser) {
    throw new HttpError(400, INVALID_ADMIN_EMAIL_MESSAGE)
  }

  const profileResult = await adminClient
    .from('hid_user_profiles')
    .select('app_role, active, deleted_at')
    .eq('auth_user_id', authUser.auth_user_id)
    .maybeSingle()
  if (profileResult.error) throw new HttpError(400, 'We could not verify that admin email right now.', profileResult.error)

  const profile = profileResult.data as ProfileRow | null
  if (!profile || profile.app_role !== 'platform_admin' || !profile.active || profile.deleted_at) {
    throw new HttpError(400, INVALID_ADMIN_EMAIL_MESSAGE)
  }

  await sendAdminOtp(email, body.turnstileToken)
  return json({ data: { eligible: true } })
}))
