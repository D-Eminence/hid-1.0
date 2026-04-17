import { createAdminClient } from '../_shared/auth.ts'
import { HttpError, json, withErrorHandling } from '../_shared/http.ts'

Deno.serve(req => withErrorHandling(req, async () => {
  if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.')

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('hid_user_profiles')
    .select('id', { head: true, count: 'exact' })
    .limit(1)

  if (error) {
    throw new HttpError(500, 'Database health check failed.', error)
  }

  return json({
    data: {
      service: 'hid-supabase-edge',
      ok: true,
      timestamp: new Date().toISOString(),
    },
  })
}))
