import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  accessPin?: string | null
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const body = await readJson<Payload>(req)

  const { data, error } = await client.rpc('hid_set_my_access_pin', {
    p_access_pin: optionalTrimmedString(body.accessPin),
  })

  if (error) throw new HttpError(400, error.message, error)
  return json({ data }, 200)
}))
