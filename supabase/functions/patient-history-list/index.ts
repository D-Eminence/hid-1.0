import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, withErrorHandling } from '../_shared/http.ts'

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const url = new URL(req.url)
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '50'), 200))

  const { data, error } = await client.rpc('hid_list_my_access_history', {
    p_limit: limit,
  })

  if (error) throw new HttpError(400, error.message, error)
  return json({ data })
}))
