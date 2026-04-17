import { createAdminClient } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { sendPatientPasswordResetCode } from '../_shared/notifications.ts'
import { createPatientPasswordResetChallenge, passwordResetOtpTtlMinutes } from '../_shared/otp.ts'
import { resolvePatientAuthIdentity } from '../_shared/patient-identifiers.ts'
import { verifyTurnstileToken } from '../_shared/turnstile.ts'
import { asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  identifier: string
  turnstileToken?: string | null
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const identifier = asTrimmedString(body.identifier, 'identifier')
  await verifyTurnstileToken(req, body.turnstileToken ?? null, 'patient-reset-start')

  const adminClient = createAdminClient()
  const resolvedIdentity = await resolvePatientAuthIdentity(adminClient, identifier)
  if (!resolvedIdentity) {
    throw new HttpError(404, 'No patient account was found for those details.')
  }
  if (!resolvedIdentity.email) {
    throw new HttpError(400, 'This account does not have an email address for password reset.')
  }

  const challenge = await createPatientPasswordResetChallenge(adminClient, {
    authUserId: resolvedIdentity.authUserId,
    deliveryChannels: ['email'],
    deliverySummary: {
      maskedEmail: resolvedIdentity.email,
      maskedPhone: null,
    },
    metadata: {
      hid_code: resolvedIdentity.hidCode,
    },
    patientId: resolvedIdentity.patientId,
  })

  const deliveries = await sendPatientPasswordResetCode({
    code: challenge.code,
    email: resolvedIdentity.email,
    expiresInMinutes: passwordResetOtpTtlMinutes(),
    hidCode: resolvedIdentity.hidCode,
    patientName: resolvedIdentity.fullName,
  })

  await adminClient.from('hid_notifications').insert({
    user_profile_id: resolvedIdentity.userProfileId,
    patient_id: resolvedIdentity.patientId,
    title: 'Password reset code requested',
    message: 'A password reset code was sent to your registered email address. If this was not you, change your password after you sign in.',
    type: 'security',
  })

  await adminClient.from('hid_audit_events').insert({
    actor_user_id: resolvedIdentity.authUserId,
    patient_id: resolvedIdentity.patientId,
    resource_type: 'auth',
    action: 'patient_password_reset_requested',
    reason: 'Patient password reset code requested.',
    metadata: {
      challenge_id: challenge.challengeId,
      delivery_channels: deliveries.receipts.map(item => item.channel),
    },
  })

  return json({
    data: {
      challengeId: challenge.challengeId,
      deliveryChannels: deliveries.receipts.map(item => item.channel),
      expiresAt: challenge.expiresAt,
      hidCode: resolvedIdentity.hidCode,
      maskedEmail: deliveries.receipts.find(item => item.channel === 'email')?.maskedTarget ?? null,
      maskedPhone: null,
    },
  })
}))
