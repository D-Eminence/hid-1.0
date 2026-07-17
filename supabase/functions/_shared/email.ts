import { optionalEnv, requireEnv } from './env.ts'

export type TransactionalEmailProvider = 'brevo'

type SenderIdentity = {
  email: string
  name: string
}

function parseSenderIdentity(value: string, fallbackName: string, fallbackEmail: string): SenderIdentity {
  const trimmed = value.trim()
  const match = /^(.*)<([^>]+)>$/.exec(trimmed)

  if (match) {
    const name = match[1]?.trim().replace(/^"|"$/g, '') || fallbackName
    const email = match[2]?.trim() || fallbackEmail
    return { email, name }
  }

  if (trimmed.includes('@')) {
    return {
      email: trimmed,
      name: fallbackName,
    }
  }

  return {
    email: fallbackEmail,
    name: fallbackName,
  }
}

function getBrevoConfig() {
  const apiKey = requireEnv('BREVO_API_KEY').trim()
  const senderValue = optionalEnv('BREVO_FROM_EMAIL', 'Health Identity Directory <support@healthidentitydirectory.com>')
  const senderNameOverride = optionalEnv('BREVO_FROM_NAME').trim()
  const sender = parseSenderIdentity(senderValue, senderNameOverride || 'Health Identity Directory', 'support@healthidentitydirectory.com')

  if (senderNameOverride) {
    sender.name = senderNameOverride
  }

  return {
    apiKey,
    sender,
  }
}

export function getConfiguredEmailProvider(): TransactionalEmailProvider {
  return 'brevo'
}

export async function sendTransactionalEmail(to: string, subject: string, html: string) {
  const brevo = getBrevoConfig()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)

  let response: Response
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': brevo.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: brevo.sender,
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Unable to send email right now.')
    }
    throw new Error('Unable to send email right now.')
  } finally {
    clearTimeout(timeoutId)
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String(payload.message)
      : 'Unable to send email.'
    throw new Error(message)
  }
}
