import { createAdminClient } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { verifyPatientPasswordResetChallenge } from '../_shared/otp.ts'
import { asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  challengeId: string
  code: string
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const challengeId = asTrimmedString(body.challengeId, 'challengeId')
  const code = asTrimmedString(body.code, 'code')

  const adminClient = createAdminClient()
  const result = await verifyPatientPasswordResetChallenge(adminClient, challengeId, code)

  await adminClient.from('hid_audit_events').insert({
    actor_user_id: result.challenge.auth_user_id,
    patient_id: result.challenge.patient_id,
    resource_type: 'auth',
    action: 'patient_password_reset_code_verified',
    reason: 'Patient password reset code verified.',
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
