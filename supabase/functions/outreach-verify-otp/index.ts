import { createAdminClient } from '../_shared/auth.ts'
import { requireEnv, optionalEnv } from '../_shared/env.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'

const SUPABASE_URL = requireEnv('SUPABASE_URL')
const SUPABASE_ANON_KEY = requireEnv('SUPABASE_ANON_KEY')

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string) {
  const input = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return toHex(new Uint8Array(digest))
}

function pepper() {
  return optionalEnv('HID_OTP_PEPPER', 'hid-dev-otp-pepper')
}

async function hashOtp(code: string) {
  return sha256(`${pepper()}:outreach_signup:${code}`)
}

type Payload = { otpId: string; code: string }

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const otpId = (body.otpId ?? '').trim()
  const code = (body.code ?? '').trim().replace(/\s/g, '')

  if (!otpId) throw new HttpError(400, 'Verification session is missing. Please start again.')
  if (!code || code.length !== 6) throw new HttpError(400, 'Please enter the full 6-digit code.')

  const adminClient = createAdminClient()

  const { data: otp, error: fetchError } = await adminClient
    .from('hid_outreach_otp')
    .select('*')
    .eq('id', otpId)
    .single()

  if (fetchError || !otp) {
    throw new HttpError(400, 'This verification session could not be found. Please start your registration again.')
  }

  if (otp.consumed_at) {
    throw new HttpError(400, 'This verification session has already been used. Sign in to access your workspace.')
  }

  if (new Date(otp.expires_at) <= new Date()) {
    throw new HttpError(400, 'This verification code has expired. Go back and request a new one.')
  }

  if (otp.attempt_count >= otp.max_attempts) {
    throw new HttpError(429, 'Too many incorrect attempts. Please go back and request a new verification code.')
  }

  const incomingHash = await hashOtp(code)
  if (incomingHash !== otp.otp_hash) {
    await adminClient
      .from('hid_outreach_otp')
      .update({ attempt_count: otp.attempt_count + 1 })
      .eq('id', otpId)

    const remaining = otp.max_attempts - otp.attempt_count - 1
    const hint = remaining > 0
      ? ` You have ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      : ' You have no attempts remaining — please request a new code.'
    throw new HttpError(400, `That code doesn't match.${hint}`)
  }

  // Code is correct — mark as verified
  await adminClient
    .from('hid_outreach_otp')
    .update({ verified_at: new Date().toISOString() })
    .eq('id', otpId)

  // Extract campaign data and recover real password
  const meta = otp.metadata as Record<string, string>
  const displayName = meta.displayName ?? ''
  const campaignName = meta.campaignName ?? ''
  const org = meta.org ?? ''
  const location = meta.location ?? ''
  const startsAt = meta.startsAt ?? ''
  const authUserId = otp.auth_user_id as string
  const email = otp.email as string

  let realPassword: string
  try {
    realPassword = atob(meta.ep ?? '')
    if (!realPassword) throw new Error('empty')
  } catch {
    throw new HttpError(500, 'Your session data is invalid. Please register again.')
  }

  // Set the user's real password
  const { error: pwError } = await adminClient.auth.admin.updateUserById(authUserId, {
    password: realPassword,
  })
  if (pwError) {
    console.error(JSON.stringify({ level: 'error', event: 'set_password_failed', otp_id: otpId, error: pwError.message }))
    throw new HttpError(500, 'We couldn\'t complete your account setup right now. Please try again.')
  }

  // Sign the user in to get a live session
  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: realPassword }),
  })
  const authData = await authResponse.json().catch(() => null)

  if (!authResponse.ok || !authData?.access_token) {
    console.error(JSON.stringify({ level: 'error', event: 'sign_in_after_verify_failed', otp_id: otpId }))
    throw new HttpError(500, 'Account verified but we couldn\'t sign you in automatically. Please sign in manually.')
  }

  // Create campaign
  const { data: campaign, error: campaignError } = await adminClient
    .from('hid_outreach_campaigns')
    .insert({
      name: campaignName,
      org,
      location,
      starts_at: new Date(startsAt).toISOString(),
      status: 'planned',
      services: ['registration'],
    })
    .select('*')
    .single()

  if (campaignError || !campaign) {
    console.error(JSON.stringify({ level: 'error', event: 'create_campaign_failed', otp_id: otpId, error: campaignError?.message }))
    throw new HttpError(500, 'Your account is ready but we couldn\'t create the campaign. Sign in and try setting it up again.')
  }

  // Create worker (admin role)
  const { data: worker, error: workerError } = await adminClient
    .from('hid_outreach_workers')
    .insert({
      auth_user_id: authUserId,
      campaign_id: campaign.id,
      display_name: displayName,
      role: 'admin',
    })
    .select('*')
    .single()

  if (workerError || !worker) {
    console.error(JSON.stringify({ level: 'error', event: 'create_worker_failed', otp_id: otpId, error: workerError?.message }))
    throw new HttpError(500, 'Campaign created but we couldn\'t link your account. Sign in and contact support.')
  }

  // Consume the OTP — clear sensitive metadata
  await adminClient
    .from('hid_outreach_otp')
    .update({
      consumed_at: new Date().toISOString(),
      metadata: { campaignName, org, location, startsAt, displayName }, // ep removed
    })
    .eq('id', otpId)

  console.log(JSON.stringify({
    level: 'info',
    event: 'otp_verified',
    email,
    auth_user_id: authUserId,
    campaign_id: campaign.id,
    worker_id: worker.id,
  }))

  await adminClient
    .from('hid_outreach_auth_log')
    .insert({
      event: 'signup_verified',
      email,
      auth_user_id: authUserId,
      worker_id: worker.id,
      campaign_id: campaign.id,
      metadata: { otp_id: otpId },
    })
    .then(() => undefined)
    .catch(() => undefined)

  return json({
    data: {
      session: {
        access_token: authData.access_token,
        refresh_token: authData.refresh_token,
        expires_in: authData.expires_in,
        token_type: authData.token_type ?? 'bearer',
      },
      worker,
      campaign,
    },
  })
}))
