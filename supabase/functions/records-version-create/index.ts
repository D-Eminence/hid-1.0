import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/auth.ts'
import { assertStaffRoleCapability } from '../_shared/platform.ts'
import { asTrimmedString, optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  recordId: string
  record: string
  notes?: string | null
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client, staffAccount } = await requireUser(req)
  const body = await readJson<Payload>(req)
  if (staffAccount?.role) {
    const adminClient = createAdminClient()
    await assertStaffRoleCapability(adminClient, staffAccount.role, 'can_create_records')
  }

  const { data, error } = await client.rpc('hid_append_medical_record_version', {
    p_record_id: asTrimmedString(body.recordId, 'recordId'),
    p_record: asTrimmedString(body.record, 'record'),
    p_notes: optionalTrimmedString(body.notes),
  })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data }, 201)
}))
