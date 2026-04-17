import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asTrimmedString, optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  requestId: string
  reason?: string | null
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const body = await readJson<Payload>(req)

  const { data, error } = await client.rpc('hid_deny_access_request', {
    p_request_id: asTrimmedString(body.requestId, 'requestId'),
    p_reason: optionalTrimmedString(body.reason),
  })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data }, 200)
}))
