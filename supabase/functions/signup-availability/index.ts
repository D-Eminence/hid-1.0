import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  accountType?: 'patient' | 'hospital'
  email?: string | null
  phone?: string | null
}

function normalizePhone(value: string | null | undefined) {
  return `${value ?? ''}`.replace(/[^0-9+]/g, '').trim()
}

function looksLikeEmail(value: string | null | undefined) {
  return /\S+@\S+\.\S+/.test(`${value ?? ''}`.trim())
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const accountType = body.accountType === 'hospital' ? 'hospital' : 'patient'
  const email = optionalTrimmedString(body.email)?.toLowerCase() ?? null
  const phone = normalizePhone(body.phone)

  if (!email && !phone) {
    throw new HttpError(400, 'Provide an email address or phone number to check.')
  }

  if (email && !looksLikeEmail(email)) {
    throw new HttpError(400, 'Enter a valid email address first.')
  }

  return json({
    data: {
      accountType,
      emailInUse: false,
      emailOwner: null,
      phoneInUse: false,
    },
  })
}))
