import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OTP_PEPPER = Deno.env.get('HID_OTP_PEPPER') ?? 'hid-dev-otp-pepper'
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? ''
const BREVO_FROM = Deno.env.get('BREVO_FROM_EMAIL') ?? 'Health Identity Directory <support@healthidentitydirectory.com>'
const OTP_TTL_MINUTES = 15
const RESEND_COOLDOWN_SECONDS = 60

const OUTREACH_OTP_COLUMNS = 'id, email, auth_user_id, consumed_at, resend_count, max_resends, last_resend_at, metadata'

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

function generateOtp() {
  const b = new Uint8Array(6)
  crypto.getRandomValues(b)
  return Array.from(b, x => `${x % 10}`).join('')
}

async function hashOtp(code: string) {
  return sha256(`${OTP_PEPPER}:outreach_signup:${code}`)
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  const m = local.length <= 2 ? '**' : `${local[0]}${'*'.repeat(Math.max(1, local.length - 2))}${local.at(-1)}`
  return `${m}@${domain}`
}

function parseSender(raw: string) {
  const m = /^(.*)<([^>]+)>$/.exec(raw.trim())
  if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || 'Health Identity Directory', email: m[2].trim() }
  return { name: 'Health Identity Directory', email: 'support@healthidentitydirectory.com' }
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!BREVO_API_KEY) throw new Error('Email service not configured.')
  const sender = parseSender(BREVO_FROM)
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html }),
  })
  if (!res.ok) {
    const p = await res.json().catch(() => null)
    throw new Error(p?.message ?? 'Email delivery failed.')
  }
}

function emailHtml(code: string, name: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:48px auto 24px;background:#fff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden">
  <div style="background:#1a6fd4;padding:28px 32px">
    <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:rgba(255,255,255,.75)">Health Identity Directory · Outreach</p>
    <h1 style="margin:10px 0 0;font-size:22px;font-weight:700;color:#fff">New verification code</h1>
  </div>
  <div style="padding:32px">
    <p style="margin:0 0 6px;color:#111827;font-size:15px">Hi <strong>${name}</strong>,</p>
    <p style="margin:0 0 28px;color:#6b7280;font-size:14px;line-height:1.65">Here is your new verification code. The previous one is no longer valid.</p>
    <div style="background:#f0f7ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:24px 32px;text-align:center;margin-bottom:28px">
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#1a6fd4">New verification code</p>
      <p style="margin:0;font-size:46px;font-weight:800;letter-spacing:14px;color:#111827;font-family:'Courier New',monospace">${code}</p>
    </div>
    <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6">Expires in <strong>${OTP_TTL_MINUTES} minutes</strong>. Do not share it.</p>
  </div>
  <div style="padding:18px 32px;background:#f9fafb;border-top:1px solid #f3f4f6">
    <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">Health Identity Directory · support@healthidentitydirectory.com</p>
  </div>
</div></body></html>`
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Record<string, unknown>>(req)

  const otpId = (typeof body.otpId === 'string' ? body.otpId.trim() : '')
  if (!otpId) throw new HttpError(422, 'Verification session is missing.')

  try {
    const db = adminClient()

    const { data: otp, error: fetchErr } = await db.from('hid_outreach_otp').select(OUTREACH_OTP_COLUMNS).eq('id', otpId).single()
    if (fetchErr || !otp) throw new HttpError(404, 'This verification session could not be found. Please start your registration again.', fetchErr)
    if (otp.consumed_at) throw new HttpError(409, 'This verification has already been completed.')
    if ((otp.resend_count as number) >= (otp.max_resends as number)) {
      throw new HttpError(429, "You've requested too many codes. Please wait a few minutes before trying again.")
    }

    if (otp.last_resend_at) {
      const elapsed = (Date.now() - new Date(otp.last_resend_at as string).getTime()) / 1000
      if (elapsed < RESEND_COOLDOWN_SECONDS) {
        const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)
        throw new HttpError(429, `Please wait ${wait} seconds before requesting another code.`, null, {
          headers: { 'Retry-After': `${wait}` },
        })
      }
    }

    const code = generateOtp()
    const otpHash = await hashOtp(code)
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()
    const meta = (otp.metadata ?? {}) as Record<string, string>
    const displayName = meta.displayName ?? 'there'

    const { error: updateErr } = await db.from('hid_outreach_otp').update({
      otp_hash: otpHash, expires_at: expiresAt, attempt_count: 0,
      resend_count: (otp.resend_count as number) + 1,
      last_resend_at: new Date().toISOString(),
    }).eq('id', otpId)

    if (updateErr) throw new HttpError(500, 'Unable to generate a new code. Please try again.', updateErr)

    try {
      await sendEmail(otp.email as string, 'Your new HID Outreach verification code', emailHtml(code, displayName))
    } catch (emailErr) {
      console.error(JSON.stringify({ event: 'resend_email_failed', otp_id: otpId, error: String(emailErr) }))
      throw new HttpError(502, "We couldn't send a new code right now. Please try again in a moment.", emailErr)
    }

    console.log(JSON.stringify({ event: 'otp_resent', otp_id: otpId, email: otp.email }))

    db.from('hid_outreach_auth_log').insert({
      event: 'otp_resent', email: otp.email, auth_user_id: otp.auth_user_id, metadata: { otp_id: otpId },
    }).then(() => undefined).catch(() => undefined)

    return json({
      data: {
        maskedEmail: maskEmail(otp.email as string),
        expiresAt,
        expiresInMinutes: OTP_TTL_MINUTES,
        resendsRemaining: (otp.max_resends as number) - (otp.resend_count as number) - 1,
      },
    })
  } catch (e) {
    if (e instanceof HttpError) throw e
    console.error(JSON.stringify({ event: 'unhandled_error', error: String(e) }))
    throw new HttpError(500, 'Something went wrong. Please try again in a moment.', e)
  }
}))
