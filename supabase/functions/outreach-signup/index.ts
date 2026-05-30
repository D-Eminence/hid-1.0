import { createAdminClient } from '../_shared/auth.ts'
import { sendTransactionalEmail } from '../_shared/email.ts'
import { requireEnv, optionalEnv } from '../_shared/env.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'

const SUPABASE_URL = requireEnv('SUPABASE_URL')
const SUPABASE_ANON_KEY = requireEnv('SUPABASE_ANON_KEY')
const OTP_TTL_MINUTES = 15
const MAX_ATTEMPTS = 5
const MAX_RESENDS = 3

function generateOtp(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => `${b % 10}`).join('')
}

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

function maskEmail(email: string) {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  const masked = local.length <= 2 ? '**' : `${local[0]}${'*'.repeat(Math.max(1, local.length - 2))}${local.at(-1)}`
  return `${masked}@${domain}`
}

function otpEmailHtml(code: string, name: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:48px auto 24px;background:#fff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden">
  <div style="background:#1a6fd4;padding:28px 32px">
    <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.75)">Health Identity Directory · Outreach</p>
    <h1 style="margin:10px 0 0;font-size:22px;font-weight:700;color:#fff">Verify your account</h1>
  </div>
  <div style="padding:32px">
    <p style="margin:0 0 6px;color:#111827;font-size:15px">Hi <strong>${name}</strong>,</p>
    <p style="margin:0 0 28px;color:#6b7280;font-size:14px;line-height:1.65">Your outreach workspace is one step away. Enter the code below to verify your email and complete setup.</p>
    <div style="background:#f0f7ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:24px 32px;text-align:center;margin-bottom:28px">
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:#1a6fd4">Verification code</p>
      <p style="margin:0;font-size:46px;font-weight:800;letter-spacing:14px;color:#111827;font-family:'Courier New',Courier,monospace">${code}</p>
    </div>
    <p style="margin:0 0 6px;color:#6b7280;font-size:13px;line-height:1.6">This code expires in <strong>${OTP_TTL_MINUTES} minutes</strong>. Do not share it with anyone.</p>
    <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6">If you didn't create an outreach account, you can safely ignore this email — no account will be created without entering this code.</p>
  </div>
  <div style="padding:18px 32px;background:#f9fafb;border-top:1px solid #f3f4f6">
    <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">Health Identity Directory &middot; <a href="mailto:support@healthidentitydirectory.com" style="color:#9ca3af">support@healthidentitydirectory.com</a></p>
  </div>
</div>
</body>
</html>`
}

type Payload = {
  email: string
  password: string
  displayName: string
  campaignName: string
  org: string
  location: string
  startsAt: string
}

function trim(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} is required.`)
  return v.trim()
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const email = trim(body.email, 'Email').toLowerCase()
  const password = trim(body.password, 'Password')
  const displayName = trim(body.displayName, 'Your name')
  const campaignName = trim(body.campaignName, 'Campaign name')
  const org = trim(body.org, 'Organization name')
  const location = trim(body.location, 'Location')
  const startsAt = trim(body.startsAt, 'Start date')

  if (!/\S+@\S+\.\S+/.test(email)) throw new HttpError(400, 'Please enter a valid email address.')
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.')

  const adminClient = createAdminClient()

  // Check for an active unexpired OTP already issued for this email
  const { data: existingOtp } = await adminClient
    .from('hid_outreach_otp')
    .select('id, auth_user_id, expires_at, resend_count, consumed_at')
    .eq('email', email)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let authUserId: string
  let otpId: string
  let isResend = false

  if (existingOtp) {
    // Reuse the existing pending registration, update campaign data
    if (existingOtp.resend_count >= MAX_RESENDS) {
      throw new HttpError(429, 'Too many verification codes requested for this email. Please wait a few minutes before trying again.')
    }
    authUserId = existingOtp.auth_user_id
    otpId = existingOtp.id
    isResend = true
  } else {
    // Create new auth user with a temporary password (replaced after OTP verification)
    const tempPassword = `hid_tmp_${toHex(crypto.getRandomValues(new Uint8Array(16)))}`
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    })

    if (createError) {
      if (createError.status === 422 || createError.message?.toLowerCase().includes('already been registered')) {
        throw new HttpError(409, 'An account with this email already exists. If you have an outreach account, sign in instead.')
      }
      console.error(JSON.stringify({ level: 'error', event: 'create_user_failed', email, error: createError.message }))
      throw new HttpError(500, 'We couldn\'t create your account right now. Please try again in a moment.')
    }

    if (!created?.user?.id) {
      throw new HttpError(500, 'We couldn\'t create your account right now. Please try again in a moment.')
    }

    authUserId = created.user.id
    otpId = crypto.randomUUID()
  }

  const code = generateOtp()
  const otpHash = await hashOtp(code)
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()
  const metadata = {
    displayName,
    campaignName,
    org,
    location,
    startsAt,
    // Store encoded password so verify step can authenticate the user
    ep: btoa(password),
  }

  if (isResend) {
    const { error: updateError } = await adminClient
      .from('hid_outreach_otp')
      .update({
        otp_hash: otpHash,
        expires_at: expiresAt,
        attempt_count: 0,
        metadata,
        resend_count: (existingOtp!.resend_count ?? 0) + 1,
        last_resend_at: new Date().toISOString(),
      })
      .eq('id', otpId)

    if (updateError) throw new HttpError(500, 'Unable to refresh your verification code. Please try again.')
  } else {
    const { error: insertError } = await adminClient
      .from('hid_outreach_otp')
      .insert({
        id: otpId,
        email,
        auth_user_id: authUserId,
        otp_hash: otpHash,
        metadata,
        expires_at: expiresAt,
        max_attempts: MAX_ATTEMPTS,
        max_resends: MAX_RESENDS,
      })

    if (insertError) throw new HttpError(500, 'Unable to set up your verification. Please try again.')
  }

  // Send the real email — only report success if this succeeds
  try {
    await sendTransactionalEmail(
      email,
      'Your HID Outreach verification code',
      otpEmailHtml(code, displayName)
    )
  } catch (emailError) {
    const message = emailError instanceof Error ? emailError.message : 'Unknown email error'
    console.error(JSON.stringify({ level: 'error', event: 'otp_email_failed', email, otp_id: otpId, error: message }))
    throw new HttpError(500, 'We couldn\'t send the verification email right now. Please check the address and try again.')
  }

  console.log(JSON.stringify({ level: 'info', event: 'otp_sent', email, otp_id: otpId, is_resend: isResend }))

  await adminClient
    .from('hid_outreach_auth_log')
    .insert({
      event: isResend ? 'otp_resent' : 'otp_sent',
      email,
      auth_user_id: authUserId,
      metadata: { otp_id: otpId, campaign_name: campaignName },
    })
    .then(() => undefined)
    .catch(() => undefined) // Non-blocking

  return json({
    data: {
      otpId,
      maskedEmail: maskEmail(email),
      expiresAt,
      expiresInMinutes: OTP_TTL_MINUTES,
    },
  })
}))
