import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { consumeAccountDeletionChallenge } from '../_shared/otp.ts'
import { asTrimmedString } from '../_shared/validation.ts'

const DELETE_BAN_DURATION = '876000h'

type Payload = {
  challengeId: string
  verificationToken: string
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { user } = await requireUser(req)
  const adminClient = createAdminClient()
  const body = await readJson<Payload>(req)
  const challengeId = asTrimmedString(body.challengeId, 'challengeId')
  const verificationToken = asTrimmedString(body.verificationToken, 'verificationToken')

  const profileResult = await adminClient
    .from('hid_user_profiles')
    .select('id, app_role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (profileResult.error) throw new HttpError(400, profileResult.error.message, profileResult.error)
  if (!profileResult.data) throw new HttpError(404, 'We could not find this account.')
  if (profileResult.data.app_role === 'platform_admin') {
    throw new HttpError(403, 'Platform admin accounts cannot be deleted here.')
  }

  const patientResult = await adminClient
    .from('hid_patients')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (patientResult.error) throw new HttpError(400, patientResult.error.message, patientResult.error)

  await consumeAccountDeletionChallenge(adminClient, {
    authUserId: user.id,
    challengeId,
    verificationToken,
  })

  const { data, error } = await adminClient.rpc('hid_soft_delete_account_by_auth_user_id', {
    p_auth_user_id: user.id,
    p_reason: 'Account deleted by user.',
    p_actor_profile_id: profileResult.data.id,
  })

  if (error) throw new HttpError(400, error.message, error)

  const banResult = await adminClient.auth.admin.updateUserById(user.id, {
    ban_duration: DELETE_BAN_DURATION,
  })
  if (banResult.error) {
    throw new HttpError(400, banResult.error.message, banResult.error)
  }

  await adminClient.from('hid_notifications').insert({
    user_profile_id: profileResult.data.id,
    patient_id: patientResult.data?.id ?? null,
    title: 'Account deleted',
    message: 'This HID account was deleted and is no longer available.',
    type: 'security',
  })

  await adminClient.from('hid_audit_events').insert({
    actor_user_id: user.id,
    actor_profile_id: profileResult.data.id,
    actor_role: profileResult.data.app_role,
    patient_id: patientResult.data?.id ?? null,
    resource_type: 'user_profile',
    resource_id: profileResult.data.id,
    action: 'account_soft_deleted',
    reason: 'Account deleted by user.',
    metadata: {
      challenge_id: challengeId,
      target_auth_user_id: user.id,
    },
  })

  return json({ data: data ?? { deleted: true } })
}))
