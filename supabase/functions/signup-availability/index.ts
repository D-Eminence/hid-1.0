import { createAdminClient } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  accountType?: 'patient' | 'hospital'
  email?: string | null
  phone?: string | null
}

type EmailOwner = 'patient' | 'hospital' | 'unknown' | null

function normalizePhone(value: string | null | undefined) {
  return `${value ?? ''}`.replace(/[^0-9+]/g, '').trim()
}

function looksLikeEmail(value: string | null | undefined) {
  return /\S+@\S+\.\S+/.test(`${value ?? ''}`.trim())
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const adminClient = createAdminClient()
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

  const [
    authEmailExistsResult,
    patientEmailResult,
    staffEmailResult,
    patientPhoneResult,
  ] = await Promise.all([
    email ? adminClient.rpc('hid_auth_email_exists', { p_email: email }) : Promise.resolve({ data: false, error: null }),
    email
      ? adminClient.from('hid_patients').select('id').eq('email', email).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    email
      ? adminClient.from('hid_staff_accounts').select('id').eq('email', email).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    phone
      ? adminClient.from('hid_patient_identifiers').select('patient_id').eq('identifier_type', 'phone').eq('normalized_value', phone).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (authEmailExistsResult.error) throw new HttpError(400, authEmailExistsResult.error.message, authEmailExistsResult.error)
  if (patientEmailResult.error) throw new HttpError(400, patientEmailResult.error.message, patientEmailResult.error)
  if (staffEmailResult.error) throw new HttpError(400, staffEmailResult.error.message, staffEmailResult.error)
  if (patientPhoneResult.error) throw new HttpError(400, patientPhoneResult.error.message, patientPhoneResult.error)

  const patientEmailInUse = Boolean(patientEmailResult.data)
  const staffEmailInUse = Boolean(staffEmailResult.data)
  const authEmailInUse = Boolean(authEmailExistsResult.data)

  let emailOwner: EmailOwner = null
  if (patientEmailInUse) emailOwner = 'patient'
  else if (staffEmailInUse) emailOwner = 'hospital'
  else if (authEmailInUse) emailOwner = 'unknown'

  const phoneInUse = Boolean(patientPhoneResult.data)

  return json({
    data: {
      accountType,
      emailInUse: authEmailInUse || patientEmailInUse || staffEmailInUse,
      emailOwner,
      phoneInUse,
    },
  })
}))
