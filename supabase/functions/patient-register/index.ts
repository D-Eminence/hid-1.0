import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asTrimmedString, normalizePhone, optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  firstName: string
  lastName: string
  gender?: string | null
  dob?: string | null
  phone?: string | null
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const body = await readJson<Payload>(req)
  const firstName = asTrimmedString(body.firstName, 'firstName')
  const lastName = asTrimmedString(body.lastName, 'lastName')

  const { data, error } = await client.rpc('hid_register_patient_profile', {
    p_first_name: firstName,
    p_last_name: lastName,
    p_gender: optionalTrimmedString(body.gender),
    p_dob: optionalTrimmedString(body.dob),
    p_phone_e164: normalizePhone(body.phone),
  })

  if (error) throw new HttpError(400, error.message, error)
  return json({ data }, 201)
}))
