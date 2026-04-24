import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, withErrorHandling } from '../_shared/http.ts'
import { resolvePatientAccessState } from '../_shared/patient-identifiers.ts'

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const url = new URL(req.url)
  const patientIdentifier = url.searchParams.get('patientIdentifier')

  if (patientIdentifier?.trim()) {
    const adminClient = createAdminClient()
    const patientState = await resolvePatientAccessState(adminClient, patientIdentifier)

    if (patientState?.profileDeleted || patientState?.patientDeleted) {
      throw new HttpError(403, 'This patient account has been deleted and cannot be opened by a hospital.')
    }
    if (patientState?.profileActive === false) {
      throw new HttpError(403, 'This patient account is locked right now.')
    }
  }

  const { data, error } = await client.rpc('hid_get_patient_records', {
    p_patient_identifier: patientIdentifier,
  })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data })
}))
