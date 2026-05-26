import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { buildCacheHeaders, HttpError, json, withErrorHandling } from '../_shared/http.ts'
import { assertStaffRoleCapability } from '../_shared/platform.ts'

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')

  const { client, staffAccount, profile } = await requireUser(req)
  if (staffAccount?.role) {
    const adminClient = createAdminClient()
    await assertStaffRoleCapability(adminClient, staffAccount.role, 'can_view_history')
  } else if (profile?.app_role !== 'patient' && profile?.app_role !== 'platform_admin') {
    throw new HttpError(403, 'This account is not allowed to view access history right now.')
  }
  const url = new URL(req.url)
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '50'), 200))

  const { data, error } = await client.rpc('hid_list_my_audit_events', {
    p_limit: limit,
  })

  if (error) throw new HttpError(400, error.message, error)
  return json({ data }, 200, buildCacheHeaders({
    maxAgeSeconds: 10,
    staleWhileRevalidateSeconds: 45,
  }))
}))
