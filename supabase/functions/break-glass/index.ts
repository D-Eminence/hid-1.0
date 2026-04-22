import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { resolvePatientAccessState } from '../_shared/patient-identifiers.ts'
import { asPositiveInt, asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  patientIdentifier: string
  reason: string
  durationMinutes?: number
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const body = await readJson<Payload>(req)
  const patientIdentifier = asTrimmedString(body.patientIdentifier, 'patientIdentifier')
  const adminClient = createAdminClient()
  const patientState = await resolvePatientAccessState(adminClient, patientIdentifier)

  if (patientState?.profileActive === false) {
    throw new HttpError(403, 'This patient account is locked right now.')
  }

  const { data, error } = await client.rpc('hid_break_glass_access', {
    p_patient_identifier: patientIdentifier,
    p_reason: asTrimmedString(body.reason, 'reason'),
    p_duration_minutes: asPositiveInt(body.durationMinutes, 'durationMinutes', 30, 240),
  })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data }, 201)
}))
