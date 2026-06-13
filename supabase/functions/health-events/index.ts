import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { resolvePatientAccessState } from '../_shared/patient-identifiers.ts'
import { assertStaffRoleCapability } from '../_shared/platform.ts'
import { asTrimmedString, optionalTrimmedString } from '../_shared/validation.ts'

type CreatePayload = {
  patientIdentifier: string
  title: string
  infoCategory?: string
  recordIds?: string[]
}

Deno.serve(req => withErrorHandling(req, async () => {
  const { client, staffAccount } = await requireUser(req)
  const adminClient = createAdminClient()

  if (req.method === 'GET') {
    const url = new URL(req.url)
    const patientIdentifier = url.searchParams.get('patientIdentifier')

    if (staffAccount?.role) {
      await assertStaffRoleCapability(adminClient, staffAccount.role, 'can_view_patient_records')
    }

    if (patientIdentifier?.trim()) {
      const patientState = await resolvePatientAccessState(adminClient, patientIdentifier)
      if (patientState?.profileDeleted || patientState?.patientDeleted) {
        throw new HttpError(403, 'This patient account has been deleted and cannot be opened by a hospital.')
      }
      if (patientState?.profileActive === false) {
        throw new HttpError(403, 'This patient account is locked right now.')
      }
    }

    const { data, error } = await client.rpc('hid_get_patient_health_events', {
      p_patient_identifier: patientIdentifier,
    })

    if (error) throw new HttpError(403, error.message, error)
    return json({ data: data ?? [] })
  }

  if (req.method === 'POST') {
    const body = await readJson<CreatePayload>(req)
    const patientIdentifier = asTrimmedString(body.patientIdentifier, 'patientIdentifier')

    if (staffAccount?.role) {
      await assertStaffRoleCapability(adminClient, staffAccount.role, 'can_create_records')
    }

    const patientState = await resolvePatientAccessState(adminClient, patientIdentifier)
    if (patientState?.profileDeleted || patientState?.patientDeleted) {
      throw new HttpError(403, 'This patient account has been deleted and cannot be opened by a hospital.')
    }
    if (patientState?.profileActive === false) {
      throw new HttpError(403, 'This patient account is locked right now.')
    }

    const { data, error } = await client.rpc('hid_create_health_event', {
      p_patient_identifier: patientIdentifier,
      p_title: asTrimmedString(body.title, 'title'),
      p_info_category: optionalTrimmedString(body.infoCategory) ?? 'general',
      p_record_ids: Array.isArray(body.recordIds) && body.recordIds.length > 0 ? body.recordIds : null,
    })

    if (error) throw new HttpError(403, error.message, error)
    return json({ data }, 201)
  }

  throw new HttpError(405, 'Method not allowed.')
}))
