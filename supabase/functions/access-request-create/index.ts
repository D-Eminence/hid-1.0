import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { resolvePatientAccessState } from '../_shared/patient-identifiers.ts'
import { asPositiveInt, asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  patientIdentifier: string
  accessPin?: string | null
  scope?: 'read_records' | 'write_records'
  reason?: string | null
  durationMinutes?: number
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const body = await readJson<Payload>(req)

  const patientIdentifier = asTrimmedString(body.patientIdentifier, 'patientIdentifier')
  const durationMinutes = asPositiveInt(body.durationMinutes, 'durationMinutes', 60)
  const accessPin = typeof body.accessPin === 'string' && body.accessPin.trim() ? body.accessPin.trim() : null
  const adminClient = createAdminClient()
  const patientState = await resolvePatientAccessState(adminClient, patientIdentifier)

  if (patientState?.profileActive === false) {
    throw new HttpError(403, 'This patient account is locked right now.')
  }

  const { data, error } = accessPin
    ? await client.rpc('hid_access_patient_with_pin', {
        p_patient_identifier: patientIdentifier,
        p_access_pin: accessPin,
        p_duration_minutes: durationMinutes,
      })
    : await client.rpc('hid_create_access_request', {
        p_patient_identifier: patientIdentifier,
        p_scope: asTrimmedString(body.scope ?? 'write_records', 'scope'),
        p_reason: asTrimmedString(body.reason, 'reason'),
        p_duration_minutes: durationMinutes,
      })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data }, 201)
}))
