import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { buildCacheHeaders, HttpError, json, withErrorHandling } from '../_shared/http.ts'
import { assertStaffRoleCapability } from '../_shared/platform.ts'

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')

  const { client, staffAccount } = await requireUser(req)
  if (!staffAccount?.role) {
    throw new HttpError(403, 'Only hospital staff can open the dashboard.')
  }
  const adminClient = createAdminClient()
  await assertStaffRoleCapability(adminClient, staffAccount.role, 'can_open_dashboard')
  const url = new URL(req.url)
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '50'), 200))

  const { data, error } = await client.rpc('hid_get_my_staff_dashboard', {
    p_limit: limit,
  })

  if (error) throw new HttpError(400, error.message, error)
  return json({ data }, 200, buildCacheHeaders({
    maxAgeSeconds: 10,
    staleWhileRevalidateSeconds: 45,
  }))
}))
