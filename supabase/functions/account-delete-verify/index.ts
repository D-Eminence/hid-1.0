import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { verifyAccountDeletionChallenge } from '../_shared/otp.ts'
import { asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  challengeId: string
  code: string
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { user } = await requireUser(req)
  const body = await readJson<Payload>(req)
  const challengeId = asTrimmedString(body.challengeId, 'challengeId')
  const code = asTrimmedString(body.code, 'code')

  const adminClient = createAdminClient()
  const result = await verifyAccountDeletionChallenge(adminClient, challengeId, code, user.id)

  const profileResult = await adminClient
    .from('hid_user_profiles')
    .select('id, app_role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  await adminClient.from('hid_audit_events').insert({
    actor_user_id: user.id,
    actor_profile_id: profileResult.data?.id ?? null,
    actor_role: profileResult.data?.app_role ?? null,
    patient_id: result.challenge.patient_id,
    resource_type: 'auth',
    action: 'account_deletion_code_verified',
    reason: 'Account deletion code verified.',
    metadata: {
      challenge_id: challengeId,
    },
  })

  return json({
    data: {
      challengeId,
      verificationToken: result.verificationToken,
    },
  })
}))
