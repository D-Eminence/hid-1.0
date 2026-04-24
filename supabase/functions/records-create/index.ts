import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { resolvePatientAccessState } from '../_shared/patient-identifiers.ts'
import { asTrimmedString, optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  patientIdentifier: string
  title: string
  category: string
  record: string
  notes?: string | null
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const body = await readJson<Payload>(req)
  const patientIdentifier = asTrimmedString(body.patientIdentifier, 'patientIdentifier')
  const adminClient = createAdminClient()
  const patientState = await resolvePatientAccessState(adminClient, patientIdentifier)

  if (patientState?.profileDeleted || patientState?.patientDeleted) {
    throw new HttpError(403, 'This patient account has been deleted and cannot be opened by a hospital.')
  }
  if (patientState?.profileActive === false) {
    throw new HttpError(403, 'This patient account is locked right now.')
  }

  const { data, error } = await client.rpc('hid_create_medical_record', {
    p_patient_identifier: patientIdentifier,
    p_title: asTrimmedString(body.title, 'title'),
    p_category: asTrimmedString(body.category, 'category'),
    p_record: asTrimmedString(body.record, 'record'),
    p_notes: optionalTrimmedString(body.notes),
  })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data }, 201)
}))
