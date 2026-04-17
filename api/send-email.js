function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildActionLink(baseUrl, emailData) {
  const tokenHash = emailData?.token_hash
  const actionType = emailData?.email_action_type
  if (!tokenHash || !actionType) return null

  const redirectTo = emailData.redirect_to || emailData.site_url || 'https://healthidentitydirectory.com'
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/auth/v1/verify`)
  url.searchParams.set('token', tokenHash)
  url.searchParams.set('type', actionType)
  url.searchParams.set('redirect_to', redirectTo)
  return url.toString()
}

function buildSubject(actionType) {
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

function buildHeading(actionType) {
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

function buildBody(user, emailData, actionLink) {
  const actionType = emailData?.email_action_type || 'signup'
  const token = emailData?.token || ''
  const firstName =
    typeof user?.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : typeof user?.user_metadata?.name === 'string'
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
          <h2 style="margin:0 0 12px;font-size:22px;color:#0f172a">${escapeHtml(buildHeading(actionType))}</h2>
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

function parseSenderIdentity(value, fallbackName, fallbackEmail) {
  const trimmed = String(value || '').trim()
  const match = /^(.*)<([^>]+)>$/.exec(trimmed)

  if (match) {
    return {
      name: (match[1] || '').trim().replace(/^"|"$/g, '') || fallbackName,
      email: (match[2] || '').trim() || fallbackEmail,
    }
  }

  if (trimmed.includes('@')) {
    return {
      name: fallbackName,
      email: trimmed,
    }
  }

  return {
    name: fallbackName,
    email: fallbackEmail,
  }
}

async function sendEmail(to, subject, html) {
  const brevoApiKey = String(process.env.BREVO_API_KEY || '').trim()
  if (!brevoApiKey) {
    throw new Error('Missing BREVO_API_KEY.')
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': brevoApiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: (() => {
        const sender = parseSenderIdentity(
          process.env.BREVO_FROM_EMAIL || 'Health Identity Directory <support@healthidentitydirectory.com>',
          process.env.BREVO_FROM_NAME || 'Health Identity Directory',
          'support@healthidentitydirectory.com'
        )
        if (process.env.BREVO_FROM_NAME) {
          sender.name = process.env.BREVO_FROM_NAME
        }
        return sender
      })(),
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String(payload.message)
      : 'Unable to send email.'
    throw new Error(message)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const token = req.query?.hook_token
  if (!process.env.SEND_EMAIL_HOOK_TOKEN || token !== process.env.SEND_EMAIL_HOOK_TOKEN) {
    res.status(401).json({ error: 'Unauthorized.' })
    return
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const user = payload?.user || {}
    const emailData = payload?.email_data || {}
    const primaryEmail = typeof user.email === 'string' ? user.email.trim() : ''

    if (!primaryEmail) {
      res.status(400).json({ error: 'Missing user email.' })
      return
    }

    const actionType = emailData.email_action_type || 'signup'
    const actionLink = buildActionLink(process.env.VITE_SUPABASE_URL || 'https://ekcuyqrwrzvwhmbnkold.supabase.co', emailData)
    const subject = buildSubject(actionType)

    if (actionType === 'email_change' && user.new_email && emailData.token_new && emailData.token_hash) {
      const nextEmail = String(user.new_email).trim()
      const newEmailData = { ...emailData, token: emailData.token_new, token_hash: emailData.token_hash }
      await sendEmail(nextEmail, subject, buildBody({ ...user, email: nextEmail }, newEmailData, buildActionLink(process.env.VITE_SUPABASE_URL || 'https://ekcuyqrwrzvwhmbnkold.supabase.co', newEmailData)))

      if (emailData.token && emailData.token_hash_new) {
        const currentEmailData = { ...emailData, token: emailData.token, token_hash: emailData.token_hash_new }
        await sendEmail(primaryEmail, subject, buildBody(user, currentEmailData, buildActionLink(process.env.VITE_SUPABASE_URL || 'https://ekcuyqrwrzvwhmbnkold.supabase.co', currentEmailData)))
      }
    } else {
      await sendEmail(primaryEmail, subject, buildBody(user, emailData, actionLink))
    }

    res.status(200).json({})
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to send auth email.',
    })
  }
}
