import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asTrimmedString, optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  staffAccountId: string
  permissionTier: 'view_only' | 'clinical_review' | 'clinical_collaboration'
  durationPreset: '24h' | '7d' | '30d' | 'until_revoked'
  reason?: string | null
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client, staffAccount } = await requireUser(req)
  if (staffAccount) {
    throw new HttpError(403, 'Only patients can share their profile.')
  }

  const body = await readJson<Payload>(req)

  const { data, error } = await client.rpc('hid_create_share', {
    p_staff_account_id: asTrimmedString(body.staffAccountId, 'staffAccountId'),
    p_permission_tier: asTrimmedString(body.permissionTier, 'permissionTier'),
    p_duration_preset: asTrimmedString(body.durationPreset, 'durationPreset'),
    p_reason: optionalTrimmedString(body.reason),
  })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data }, 201)
}))
