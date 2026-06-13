import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { sendShareInviteEmail } from '../_shared/notifications.ts'
import { asTrimmedString, optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  email: string
  fullName?: string | null
  permissionTier: 'view_only' | 'clinical_review' | 'clinical_collaboration'
  durationPreset: '24h' | '7d' | '30d' | 'until_revoked'
  reason?: string | null
}

const PERMISSION_TIER_LABELS: Record<Payload['permissionTier'], string> = {
  view_only: 'View Only',
  clinical_review: 'Clinical Review',
  clinical_collaboration: 'Clinical Collaboration',
}

const DURATION_LABELS: Record<Payload['durationPreset'], string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  until_revoked: 'until revoked',
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client, user, staffAccount } = await requireUser(req)
  if (staffAccount) {
    throw new HttpError(403, 'Only patients can invite providers.')
  }

  const body = await readJson<Payload>(req)
  const email = asTrimmedString(body.email, 'email')
  const fullName = optionalTrimmedString(body.fullName)
  const permissionTier = asTrimmedString(body.permissionTier, 'permissionTier') as Payload['permissionTier']
  const durationPreset = asTrimmedString(body.durationPreset, 'durationPreset') as Payload['durationPreset']
  const reason = optionalTrimmedString(body.reason)

  const { data, error } = await client.rpc('hid_create_share_invite', {
    p_email: email,
    p_full_name: fullName,
    p_permission_tier: permissionTier,
    p_duration_preset: durationPreset,
    p_reason: reason,
  })

  if (error) throw new HttpError(403, error.message, error)

  if (data?.mode === 'invited') {
    const { data: patient } = await client
      .from('hid_patients')
      .select('full_name')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    await sendShareInviteEmail({
      email,
      invitedName: fullName,
      patientName: patient?.full_name ?? 'A patient',
      permissionTierLabel: PERMISSION_TIER_LABELS[permissionTier],
      durationLabel: DURATION_LABELS[durationPreset],
      reason,
    })
  }

  return json({ data }, 201)
}))
