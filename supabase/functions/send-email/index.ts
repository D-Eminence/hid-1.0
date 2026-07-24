import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'
import { optionalEnv, requireEnv } from '../_shared/env.ts'
import { sendTransactionalEmail } from '../_shared/email.ts'

type HookUser = {
  email?: string | null
  new_email?: string | null
  user_metadata?: Record<string, unknown> | null
}

type EmailData = {
  token?: string
  token_hash?: string
  redirect_to?: string
  email_action_type?: string
  site_url?: string
  token_new?: string
  token_hash_new?: string
}

type HookPayload = {
  user: HookUser
  email_data: EmailData
}

const configuredHookSecret = requireEnv('SEND_EMAIL_HOOK_SECRET')
const hookToken = optionalEnv('SEND_EMAIL_HOOK_TOKEN')
const hookSecrets = Array.from(new Set([
  configuredHookSecret,
  configuredHookSecret.replace('v1,whsec_', ''),
]))
const supabaseUrl = optionalEnv('SUPABASE_URL', 'https://ekcuyqrwrzvwhmbnkold.supabase.co').replace(/\/+$/, '')

function resolveRequestId(req: Request) {
  const provided = req.headers.get('x-request-id')?.trim() ?? ''
  if (/^[a-zA-Z0-9._:-]{8,128}$/.test(provided)) return provided
  return `hid_email_${crypto.randomUUID()}`
}

function json(data: unknown, status = 200, requestId?: string) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...(requestId ? { 'X-Request-ID': requestId } : {}),
    },
  })
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildActionLink(emailData: EmailData) {
  const tokenHash = emailData.token_hash
  const actionType = emailData.email_action_type

  if (!tokenHash || !actionType) return null

  const redirectTo = emailData.redirect_to || emailData.site_url || 'https://healthidentitydirectory.com'
  const url = new URL(`${supabaseUrl}/auth/v1/verify`)
  url.searchParams.set('token', tokenHash)
  url.searchParams.set('type', actionType)
  url.searchParams.set('redirect_to', redirectTo)
  return url.toString()
}

function buildSubject(actionType: string) {
  switch (actionType) {
    case 'signup':
      return 'Confirm your HID account'
    case 'magiclink':
    case 'email':
      return 'Your HID verification code'
    case 'recovery':
      return 'Reset your HID password'
    case 'invite':
      return 'You are invited to HID'
    case 'email_change':
      return 'Confirm your HID email change'
    case 'reauthentication':
      return 'Confirm your HID sign-in'
    default:
      return 'Your HID verification email'
  }
}

function buildHeading(actionType: string) {
  switch (actionType) {
    case 'signup':
      return 'Confirm your account'
    case 'magiclink':
    case 'email':
      return 'Enter verification code'
    case 'recovery':
      return 'Reset your password'
    case 'invite':
      return 'Accept your invite'
    case 'email_change':
      return 'Confirm your email change'
    case 'reauthentication':
      return 'Confirm your sign-in'
    default:
      return 'Verify your account'
  }
}

function buildBody(user: HookUser, emailData: EmailData, actionLink: string | null) {
  const actionType = emailData.email_action_type || 'signup'
  const subjectHeading = buildHeading(actionType)
  const token = emailData.token || ''
  const firstName = typeof user.user_metadata?.full_name === 'string'
    ? user.user_metadata.full_name
    : typeof user.user_metadata?.name === 'string'
      ? user.user_metadata.name
      : 'there'

  const intro = (() => {
    switch (actionType) {
      case 'recovery':
        return 'We received a request to reset your HID password.'
      case 'magiclink':
      case 'email':
        return 'Enter the verification code below in HID to continue.'
      case 'invite':
        return 'You have been invited to join HID.'
      case 'email_change':
        return 'Use the link below to confirm your new email address.'
      case 'reauthentication':
        return 'Use the link below to confirm this security-sensitive action.'
      default:
        return 'Enter the verification code below in HID to finish creating your account.'
    }
  })()

  const actionLabel = (() => {
    switch (actionType) {
      case 'recovery':
        return 'Reset password'
      case 'invite':
        return 'Accept invite'
      case 'email_change':
        return 'Confirm email change'
      case 'reauthentication':
        return 'Confirm action'
      default:
        return 'Confirm account'
    }
  })()

  const tokenBlock = token
    ? `
      <div style="margin:24px 0;padding:16px;border:1px dashed #8cb9ff;border-radius:14px;background:#eef5ff;text-align:center">
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#5f6b85;margin-bottom:8px">Verification code</div>
        <div style="font-size:28px;font-weight:700;letter-spacing:0.18em;color:#1a6fd4">${escapeHtml(token)}</div>
      </div>
    `
    : ''

  const linkBlock = actionType === 'signup' || actionType === 'magiclink' || actionType === 'email'
    ? ''
    : actionLink
    ? `
      <div style="margin:28px 0 24px">
        <a href="${escapeHtml(actionLink)}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#1a6fd4;color:#ffffff;text-decoration:none;font-weight:700">
          ${escapeHtml(actionLabel)}
        </a>
      </div>
      <p style="margin:0 0 12px;font-size:13px;line-height:1.7;color:#667085">
        If the button does not work, open this link:
      </p>
      <p style="margin:0;font-size:13px;line-height:1.7;word-break:break-all;color:#1a6fd4">${escapeHtml(actionLink)}</p>
    `
    : ''

  return `
    <div style="font-family:Arial,sans-serif;background:#f4f7fb;padding:24px;color:#101828">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6ebf2;border-radius:18px;overflow:hidden">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#0c5ec8,#1a6fd4);color:#ffffff">
          <div style="font-size:24px;font-weight:700">HID</div>
          <div style="font-size:12px;opacity:0.88;margin-top:4px">Health Identity Directory</div>
        </div>
        <div style="padding:28px">
          <p style="margin:0 0 12px;font-size:14px">Hello ${escapeHtml(firstName)},</p>
          <h2 style="margin:0 0 12px;font-size:22px;color:#0f172a">${escapeHtml(subjectHeading)}</h2>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.8;color:#475467">${escapeHtml(intro)}</p>
          ${tokenBlock}
          ${linkBlock}
          <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#667085">
            If you did not expect this email, you can safely ignore it.
          </p>
        </div>
      </div>
    </div>
  `
}

async function sendEmail(to: string, subject: string, html: string) {
  await sendTransactionalEmail(to, subject, html)
}

Deno.serve(async req => {
  const requestId = resolveRequestId(req)
  if (req.method !== 'POST') {
    const message = 'Method not allowed.'
    return json({
      code: 'METHOD_NOT_ALLOWED',
      error: { message },
      message,
      requestId,
      retryable: false,
      status: 405,
    }, 405, requestId)
  }

  const payloadText = await req.text()
  const headers = Object.fromEntries(req.headers)
  const requestUrl = new URL(req.url)

  try {
    const requiredHeaders = ['webhook-id', 'webhook-timestamp', 'webhook-signature']
    const hasWebhookHeaders = requiredHeaders.every(headerName => Boolean(headers[headerName]))

    let verifiedPayload: HookPayload | null = null
    let lastVerificationError: Error | null = null

    if (hasWebhookHeaders) {
      for (const candidateSecret of hookSecrets) {
        try {
          const webhook = new Webhook(candidateSecret)
          verifiedPayload = webhook.verify(payloadText, headers) as HookPayload
          break
        } catch (error) {
          lastVerificationError = error instanceof Error ? error : new Error('Webhook verification failed')
        }
      }
    }

    if (!verifiedPayload) {
      const tokenMatches = hookToken && requestUrl.searchParams.get('hook_token') === hookToken
      if (tokenMatches) {
        verifiedPayload = JSON.parse(payloadText) as HookPayload
      } else {
        throw lastVerificationError ?? new Error('Missing required headers')
      }
    }

    const { user, email_data } = verifiedPayload

    const actionType = email_data.email_action_type || 'signup'
    const actionLink = buildActionLink(email_data)
    const primaryEmail = user.email?.trim()

    if (!primaryEmail) {
      const message = 'Missing user email.'
      return json({
        code: 'INVALID_REQUEST',
        error: { message },
        message,
        requestId,
        retryable: false,
        status: 400,
      }, 400, requestId)
    }

    const deliveries: Array<Promise<void>> = []

    if (actionType === 'email_change' && user.new_email?.trim() && email_data.token_new && email_data.token_hash) {
      const nextEmail = user.new_email.trim()
      const newEmailData: EmailData = {
        ...email_data,
        token: email_data.token_new,
        token_hash: email_data.token_hash,
      }
      deliveries.push(sendEmail(nextEmail, buildSubject(actionType), buildBody({ ...user, email: nextEmail }, newEmailData, buildActionLink(newEmailData))))

      if (email_data.token && email_data.token_hash_new) {
        const currentEmailData: EmailData = {
          ...email_data,
          token: email_data.token,
          token_hash: email_data.token_hash_new,
        }
        deliveries.push(sendEmail(primaryEmail, buildSubject(actionType), buildBody(user, currentEmailData, buildActionLink(currentEmailData))))
      }
    } else {
      deliveries.push(sendEmail(primaryEmail, buildSubject(actionType), buildBody(user, email_data, actionLink)))
    }

    await Promise.all(deliveries)
    return new Response('{}', {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Request-ID': requestId,
      },
    })
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : 'Unable to send auth email.'
    const message = 'We could not send the verification email right now. Please try again.'
    console.error(JSON.stringify({
      event: 'send_email_hook_failed',
      message: internalMessage,
      request_id: requestId,
    }))
    return json({
      code: 'EMAIL_DELIVERY_FAILED',
      error: {
        message,
      },
      message,
      requestId,
      retryable: true,
      status: 502,
    }, 502, requestId)
  }
})
