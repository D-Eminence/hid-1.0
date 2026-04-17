import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asPositiveInt, asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  requestId: string
  durationMinutes?: number
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const body = await readJson<Payload>(req)

  const { data, error } = await client.rpc('hid_approve_access_request', {
    p_request_id: asTrimmedString(body.requestId, 'requestId'),
    p_duration_minutes: asPositiveInt(body.durationMinutes, 'durationMinutes', 60),
  })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data }, 200)
}))
