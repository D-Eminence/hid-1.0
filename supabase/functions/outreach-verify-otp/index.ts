import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const OTP_PEPPER = Deno.env.get('HID_OTP_PEPPER') ?? 'hid-dev-otp-pepper'

const OUTREACH_OTP_COLUMNS = 'id, email, auth_user_id, otp_hash, expires_at, consumed_at, attempt_count, max_attempts, metadata'
const OUTREACH_CAMPAIGN_COLUMNS = 'id, name, org, location, status, starts_at, ends_at, services, created_at'
const OUTREACH_WORKER_COLUMNS = 'id, auth_user_id, campaign_id, display_name, role, created_at'

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function toHex(b: Uint8Array) {
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

async function sha256(v: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))
  return toHex(new Uint8Array(buf))
}

async function hashOtp(code: string) {
  return sha256(`${OTP_PEPPER}:outreach_signup:${code}`)
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Record<string, unknown>>(req)

  const otpId = (typeof body.otpId === 'string' ? body.otpId.trim() : '')
  const code = (typeof body.code === 'string' ? body.code.trim().replace(/\s/g, '') : '')

  if (!otpId) throw new HttpError(422, 'Verification session is missing. Please start your registration again.')
  if (!code || code.length !== 6) throw new HttpError(422, 'Please enter the full 6-digit code.')

  try {
    const db = adminClient()

    const { data: otp, error: fetchErr } = await db
      .from('hid_outreach_otp')
      .select(OUTREACH_OTP_COLUMNS)
      .eq('id', otpId)
      .single()

    if (fetchErr || !otp) throw new HttpError(404, 'This verification session could not be found. Please start your registration again.', fetchErr)
    if (otp.consumed_at) throw new HttpError(409, 'This verification session has already been used. Please sign in to access your workspace.')
    if (new Date(otp.expires_at as string) <= new Date()) throw new HttpError(410, 'This verification code has expired. Go back and request a new one.')
    if ((otp.attempt_count as number) >= (otp.max_attempts as number)) {
      throw new HttpError(429, 'Too many incorrect attempts. Please go back and request a new verification code.')
    }

    const incomingHash = await hashOtp(code)
    if (incomingHash !== otp.otp_hash) {
      await db.from('hid_outreach_otp').update({ attempt_count: (otp.attempt_count as number) + 1 }).eq('id', otpId)
      const remaining = (otp.max_attempts as number) - (otp.attempt_count as number) - 1
      const hint = remaining > 0
        ? ` You have ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : ' No attempts remaining — please request a new code.'
      throw new HttpError(422, `That code doesn't match.${hint}`)
    }

    // Mark as verified
    await db.from('hid_outreach_otp').update({ verified_at: new Date().toISOString() }).eq('id', otpId)

    // Extract campaign data and recover real password
    const meta = (otp.metadata ?? {}) as Record<string, string>
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

    // Set real password on the auth user
    const { error: pwErr } = await db.auth.admin.updateUserById(authUserId, { password: realPassword })
    if (pwErr) {
      console.error(JSON.stringify({ event: 'set_password_failed', otp_id: otpId, error: pwErr.message }))
      throw new HttpError(500, "We couldn't complete your account setup right now. Please try again.", pwErr)
    }

    // Sign in to get a live session
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: realPassword }),
    })
    const authData = await authRes.json().catch(() => null)
    if (!authRes.ok || !authData?.access_token) {
      console.error(JSON.stringify({ event: 'sign_in_after_verify_failed', otp_id: otpId }))
      throw new HttpError(502, "Account verified but we couldn't sign you in automatically. Please sign in manually.", authData)
    }

    // Create campaign
    const { data: campaign, error: campaignErr } = await db
      .from('hid_outreach_campaigns')
      .insert({ name: campaignName, org, location, starts_at: new Date(startsAt).toISOString(), status: 'planned', services: ['registration'] })
      .select(OUTREACH_CAMPAIGN_COLUMNS).single()

    if (campaignErr || !campaign) {
      console.error(JSON.stringify({ event: 'create_campaign_failed', otp_id: otpId, error: campaignErr?.message }))
      throw new HttpError(500, "Your account is ready but we couldn't create the campaign. Please sign in and try setting it up again.", campaignErr)
    }

    // Create worker (admin role)
    const { data: worker, error: workerErr } = await db
      .from('hid_outreach_workers')
      .insert({ auth_user_id: authUserId, campaign_id: campaign.id, display_name: displayName, role: 'admin' })
      .select(OUTREACH_WORKER_COLUMNS).single()

    if (workerErr || !worker) {
      console.error(JSON.stringify({ event: 'create_worker_failed', otp_id: otpId, error: workerErr?.message }))
      throw new HttpError(500, "Campaign created but we couldn't link your account. Please sign in and contact support.", workerErr)
    }

    // Consume OTP and remove sensitive metadata
    await db.from('hid_outreach_otp').update({
      consumed_at: new Date().toISOString(),
      metadata: { campaignName, org, location, startsAt, displayName },
    }).eq('id', otpId)

    console.log(JSON.stringify({ event: 'signup_verified', email, auth_user_id: authUserId, campaign_id: campaign.id }))

    db.from('hid_outreach_auth_log').insert({
      event: 'signup_verified', email, auth_user_id: authUserId,
      worker_id: worker.id, campaign_id: campaign.id, metadata: { otp_id: otpId },
    }).then(() => undefined).catch(() => undefined)

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
  } catch (e) {
    if (e instanceof HttpError) throw e
    console.error(JSON.stringify({ event: 'unhandled_error', error: String(e) }))
    throw new HttpError(500, 'Something went wrong. Please try again in a moment.', e)
  }
}))
