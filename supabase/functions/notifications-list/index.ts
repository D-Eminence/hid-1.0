import { requireUser } from '../_shared/auth.ts'
import { buildCacheHeaders, HttpError, json, withErrorHandling } from '../_shared/http.ts'

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const url = new URL(req.url)
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '50'), 200))
  const unreadOnly = ['1', 'true', 'yes'].includes((url.searchParams.get('unreadOnly') ?? '').toLowerCase())
  const countOnly = ['1', 'true', 'yes'].includes((url.searchParams.get('countOnly') ?? '').toLowerCase())

  let query = client
    .from('hid_notifications')
    .select(
      countOnly
        ? 'id'
        : 'id, user_profile_id, patient_id, title, message, type, read_at, created_at',
      countOnly ? { count: 'exact', head: true } : undefined
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (unreadOnly) {
    query = query.is('read_at', null)
  }

  const { data, error, count } = await query

  if (error) throw new HttpError(400, error.message, error)

  return json({ data: countOnly ? { count: count ?? 0 } : data }, 200, buildCacheHeaders({
    maxAgeSeconds: 10,
    staleWhileRevalidateSeconds: 30,
  }))
}))
