import { createAdminClient } from '../_shared/auth.ts'
import { sendTransactionalEmail } from '../_shared/email.ts'
import { optionalEnv } from '../_shared/env.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'

const OTP_TTL_MINUTES = 15
const RESEND_COOLDOWN_SECONDS = 60

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
    <h1 style="margin:10px 0 0;font-size:22px;font-weight:700;color:#fff">New verification code</h1>
  </div>
  <div style="padding:32px">
    <p style="margin:0 0 6px;color:#111827;font-size:15px">Hi <strong>${name}</strong>,</p>
    <p style="margin:0 0 28px;color:#6b7280;font-size:14px;line-height:1.65">Here is your new verification code. The previous one is no longer valid.</p>
    <div style="background:#f0f7ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:24px 32px;text-align:center;margin-bottom:28px">
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:#1a6fd4">New verification code</p>
      <p style="margin:0;font-size:46px;font-weight:800;letter-spacing:14px;color:#111827;font-family:'Courier New',Courier,monospace">${code}</p>
    </div>
    <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6">This code expires in <strong>${OTP_TTL_MINUTES} minutes</strong>. Do not share it.</p>
  </div>
  <div style="padding:18px 32px;background:#f9fafb;border-top:1px solid #f3f4f6">
    <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">Health Identity Directory &middot; <a href="mailto:support@healthidentitydirectory.com" style="color:#9ca3af">support@healthidentitydirectory.com</a></p>
  </div>
</div>
</body>
</html>`
}

type Payload = { otpId: string }

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const otpId = (body.otpId ?? '').trim()
  if (!otpId) throw new HttpError(400, 'Verification session is missing.')

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
    throw new HttpError(400, 'This verification has already been completed.')
  }
  if (otp.resend_count >= otp.max_resends) {
    throw new HttpError(429, 'You\'ve requested too many codes. Please wait a few minutes before trying again.')
  }

  // Enforce per-resend cooldown
  if (otp.last_resend_at) {
    const lastResend = new Date(otp.last_resend_at).getTime()
    const secondsElapsed = (Date.now() - lastResend) / 1000
    if (secondsElapsed < RESEND_COOLDOWN_SECONDS) {
      const waitSeconds = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsElapsed)
      throw new HttpError(429, `Please wait ${waitSeconds} seconds before requesting another code.`)
    }
  }

  const code = generateOtp()
  const otpHash = await hashOtp(code)
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()
  const meta = otp.metadata as Record<string, string>
  const displayName = meta.displayName ?? 'there'

  const { error: updateError } = await adminClient
    .from('hid_outreach_otp')
    .update({
      otp_hash: otpHash,
      expires_at: expiresAt,
      attempt_count: 0,
      resend_count: otp.resend_count + 1,
      last_resend_at: new Date().toISOString(),
    })
    .eq('id', otpId)

  if (updateError) throw new HttpError(500, 'Unable to generate a new code. Please try again.')

  try {
    await sendTransactionalEmail(
      otp.email,
      'Your new HID Outreach verification code',
      otpEmailHtml(code, displayName)
    )
  } catch (emailError) {
    const message = emailError instanceof Error ? emailError.message : 'Email send failed'
    console.error(JSON.stringify({ level: 'error', event: 'resend_email_failed', otp_id: otpId, error: message }))
    throw new HttpError(500, 'We couldn\'t send a new code right now. Please try again in a moment.')
  }

  console.log(JSON.stringify({ level: 'info', event: 'otp_resent', otp_id: otpId, email: otp.email }))

  await adminClient
    .from('hid_outreach_auth_log')
    .insert({ event: 'otp_resent', email: otp.email, auth_user_id: otp.auth_user_id, metadata: { otp_id: otpId } })
    .then(() => undefined).catch(() => undefined)

  return json({
    data: {
      maskedEmail: maskEmail(otp.email),
      expiresAt,
      expiresInMinutes: OTP_TTL_MINUTES,
      resendsRemaining: otp.max_resends - otp.resend_count - 1,
    },
  })
}))
