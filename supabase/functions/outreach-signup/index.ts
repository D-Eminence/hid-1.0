// Self-contained — no _shared imports needed. Deploy this single file via Dashboard.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const OTP_PEPPER = Deno.env.get('HID_OTP_PEPPER') ?? 'hid-dev-otp-pepper'
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? ''
const BREVO_FROM = Deno.env.get('BREVO_FROM_EMAIL') ?? 'Health Identity Directory <support@healthidentitydirectory.com>'
const OTP_TTL_MINUTES = 15
const MAX_RESENDS = 3

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function ok(data: unknown) {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
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
    <h1 style="margin:10px 0 0;font-size:22px;font-weight:700;color:#fff">Verify your account</h1>
  </div>
  <div style="padding:32px">
    <p style="margin:0 0 6px;color:#111827;font-size:15px">Hi <strong>${name}</strong>,</p>
    <p style="margin:0 0 28px;color:#6b7280;font-size:14px;line-height:1.65">Enter the code below to verify your email and complete your outreach workspace setup.</p>
    <div style="background:#f0f7ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:24px 32px;text-align:center;margin-bottom:28px">
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#1a6fd4">Verification code</p>
      <p style="margin:0;font-size:46px;font-weight:800;letter-spacing:14px;color:#111827;font-family:'Courier New',monospace">${code}</p>
    </div>
    <p style="margin:0 0 6px;color:#6b7280;font-size:13px;line-height:1.6">This code expires in <strong>${OTP_TTL_MINUTES} minutes</strong>. Do not share it.</p>
    <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6">If you didn't request this, you can safely ignore this email.</p>
  </div>
  <div style="padding:18px 32px;background:#f9fafb;border-top:1px solid #f3f4f6">
    <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">Health Identity Directory · support@healthidentitydirectory.com</p>
  </div>
</div></body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (req.method !== 'POST') return err(405, 'Method not allowed.')

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err(400, 'Invalid request body.') }

  const email = (typeof body.email === 'string' ? body.email.trim().toLowerCase() : '')
  const password = (typeof body.password === 'string' ? body.password.trim() : '')
  const displayName = (typeof body.displayName === 'string' ? body.displayName.trim() : '')
  const campaignName = (typeof body.campaignName === 'string' ? body.campaignName.trim() : '')
  const org = (typeof body.org === 'string' ? body.org.trim() : '')
  const location = (typeof body.location === 'string' ? body.location.trim() : '')
  const startsAt = (typeof body.startsAt === 'string' ? body.startsAt.trim() : '')

  if (!email || !/\S+@\S+\.\S+/.test(email)) return err(400, 'Please enter a valid email address.')
  if (!password || password.length < 8) return err(400, 'Password must be at least 8 characters.')
  if (!displayName) return err(400, 'Your name is required.')
  if (!campaignName) return err(400, 'Campaign name is required.')
  if (!org) return err(400, 'Organization name is required.')
  if (!location) return err(400, 'Location is required.')
  if (!startsAt) return err(400, 'Start date is required.')

  try {
    const db = adminClient()

    // Check for an active unexpired OTP for this email
    const { data: existingOtp } = await db
      .from('hid_outreach_otp')
      .select('id, auth_user_id, expires_at, resend_count')
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
      if ((existingOtp.resend_count ?? 0) >= MAX_RESENDS) {
        return err(429, 'Too many verification codes requested. Please wait a few minutes before trying again.')
      }
      authUserId = existingOtp.auth_user_id as string
      otpId = existingOtp.id as string
      isResend = true
    } else {
      const tempPw = `hid_tmp_${toHex(crypto.getRandomValues(new Uint8Array(16)))}`
      const { data: created, error: createError } = await db.auth.admin.createUser({
        email,
        password: tempPw,
        email_confirm: true,
      })

      if (createError) {
        if (createError.status === 422 || createError.message?.toLowerCase().includes('already been registered')) {
          return err(409, 'An account with this email already exists. If you have an outreach account, please sign in instead.')
        }
        console.error(JSON.stringify({ event: 'create_user_failed', email, error: createError.message }))
        return err(500, "We couldn't create your account right now. Please try again in a moment.")
      }

      if (!created?.user?.id) return err(500, "We couldn't create your account right now. Please try again.")

      authUserId = created.user.id
      otpId = crypto.randomUUID()
    }

    const code = generateOtp()
    const otpHash = await hashOtp(code)
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()
    const metadata = { displayName, campaignName, org, location, startsAt, ep: btoa(password) }

    if (isResend) {
      const { error: updateErr } = await db.from('hid_outreach_otp').update({
        otp_hash: otpHash, expires_at: expiresAt, attempt_count: 0, metadata,
        resend_count: ((existingOtp as any).resend_count ?? 0) + 1,
        last_resend_at: new Date().toISOString(),
      }).eq('id', otpId)
      if (updateErr) return err(500, 'Unable to refresh your verification code. Please try again.')
    } else {
      const { error: insertErr } = await db.from('hid_outreach_otp').insert({
        id: otpId, email, auth_user_id: authUserId, otp_hash: otpHash,
        metadata, expires_at: expiresAt, max_attempts: 5, max_resends: MAX_RESENDS,
      })
      if (insertErr) return err(500, 'Unable to set up your verification. Please try again.')
    }

    // Send real email — only succeed if Brevo accepts it
    try {
      await sendEmail(email, 'Your HID Outreach verification code', emailHtml(code, displayName))
    } catch (emailErr) {
      console.error(JSON.stringify({ event: 'email_failed', email, otp_id: otpId, error: String(emailErr) }))
      return err(500, "We couldn't send the verification email. Please check the address and try again.")
    }

    console.log(JSON.stringify({ event: isResend ? 'otp_resent' : 'otp_sent', email, otp_id: otpId }))

    // Log (non-blocking)
    db.from('hid_outreach_auth_log').insert({
      event: isResend ? 'otp_resent' : 'otp_sent', email, auth_user_id: authUserId,
      metadata: { otp_id: otpId, campaign_name: campaignName },
    }).then(() => undefined).catch(() => undefined)

    return ok({ otpId, maskedEmail: maskEmail(email), expiresAt, expiresInMinutes: OTP_TTL_MINUTES })
  } catch (e) {
    console.error(JSON.stringify({ event: 'unhandled_error', error: String(e) }))
    return err(500, 'Something went wrong. Please try again in a moment.')
  }
})
