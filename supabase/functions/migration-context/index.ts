import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { buildCacheHeaders, HttpError, json, withErrorHandling } from '../_shared/http.ts'
import { assertPlatformFeatureEnabled, assertStaffRoleCapability } from '../_shared/platform.ts'

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')

  const { client, staffAccount } = await requireUser(req)
  if (!staffAccount?.role) {
    throw new HttpError(403, 'An active HID hospital staff account is required for Migrate.')
  }

  const adminClient = createAdminClient()
  await assertPlatformFeatureEnabled(adminClient, 'migrate')
  await assertStaffRoleCapability(adminClient, staffAccount.role, 'can_open_dashboard')

  const { data, error } = await client.rpc('hid_get_my_migration_context')
  if (error) throw new HttpError(400, error.message, error)

  return json({ data }, 200, buildCacheHeaders({
    maxAgeSeconds: 0,
    staleWhileRevalidateSeconds: 0,
  }))
}))
