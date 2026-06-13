import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  inviteId: string
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client, staffAccount } = await requireUser(req)
  if (staffAccount) {
    throw new HttpError(403, 'Only patients can cancel invitations.')
  }

  const body = await readJson<Payload>(req)

  const { data, error } = await client.rpc('hid_cancel_share_invite', {
    p_invite_id: asTrimmedString(body.inviteId, 'inviteId'),
  })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data }, 200)
}))
