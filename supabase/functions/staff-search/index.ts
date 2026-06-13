import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, withErrorHandling } from '../_shared/http.ts'

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')

  const { client, staffAccount } = await requireUser(req)
  if (staffAccount) {
    throw new HttpError(403, 'Only patients can search for providers to share with.')
  }

  const url = new URL(req.url)
  const query = url.searchParams.get('query') ?? ''

  const { data, error } = await client.rpc('hid_search_staff_for_share', {
    p_query: query,
  })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data: data ?? [] })
}))
