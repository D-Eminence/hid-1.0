import { optionalEnv } from './env.ts'
import { HttpError } from './http.ts'

function clientIpAddress(req: Request) {
  const cfIp = req.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp
  const forwardedFor = req.headers.get('x-forwarded-for')
  return forwardedFor?.split(',')[0]?.trim() ?? ''
}

export function turnstileEnabled() {
  return Boolean(optionalEnv('HID_TURNSTILE_SECRET_KEY'))
}

export async function verifyTurnstileToken(req: Request, token: string | null | undefined, action: string) {
  const secret = optionalEnv('HID_TURNSTILE_SECRET_KEY')
  if (!secret) return

  if (!token) {
    throw new HttpError(400, 'Complete the security check to continue.')
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  })

  const remoteIp = clientIpAddress(req)
  if (remoteIp) {
    body.set('remoteip', remoteIp)
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const payload = await response.json().catch(() => null) as
    | { success?: boolean; action?: string; 'error-codes'?: string[] }
    | null

  if (!response.ok || !payload?.success) {
    throw new HttpError(400, 'Complete the security check to continue.', payload?.['error-codes'] ?? payload)
  }

  if (payload.action && payload.action !== action) {
    throw new HttpError(400, 'Security validation failed. Please try again.')
  }
}
