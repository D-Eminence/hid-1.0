import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'

type Payload = {
  accountType?: 'patient' | 'hospital'
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const accountType = body.accountType === 'hospital' ? 'hospital' : 'patient'
  const { user } = await requireUser(req)
  const adminClient = createAdminClient()

  const result = accountType === 'hospital'
    ? await adminClient.from('hid_staff_accounts').select('id').eq('auth_user_id', user.id).is('deleted_at', null).limit(1)
    : await adminClient.from('hid_patients').select('id').eq('auth_user_id', user.id).is('deleted_at', null).limit(1)

  if (result.error) throw new HttpError(400, 'We could not verify this HID account right now.', result.error)
  if ((result.data ?? []).length > 0) {
    return json({ data: { registered: true } })
  }

  const deleteResult = await adminClient.auth.admin.deleteUser(user.id)
  if (deleteResult.error) {
    throw new HttpError(400, 'The unregistered Google login could not be cleared right now.', deleteResult.error)
  }

  return json({ data: { registered: false } })
}))
