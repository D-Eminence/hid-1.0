import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asTrimmedString, normalizePhone, optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  fullName: string
  hospitalName?: string | null
  licenseNumber?: string | null
  onboardingType?: string | null
  phone?: string | null
  country?: string | null
  state?: string | null
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const body = await readJson<Payload>(req)

  const { data, error } = await client.rpc('hid_complete_staff_onboarding', {
    p_full_name: asTrimmedString(body.fullName, 'fullName'),
    p_hospital_name: optionalTrimmedString(body.hospitalName),
    p_license_number: optionalTrimmedString(body.licenseNumber),
    p_onboarding_type: optionalTrimmedString(body.onboardingType),
    p_phone_e164: normalizePhone(body.phone),
    p_country: optionalTrimmedString(body.country),
    p_state: optionalTrimmedString(body.state),
  })

  if (error) throw new HttpError(400, error.message, error)
  return json({ data }, 200)
}))
