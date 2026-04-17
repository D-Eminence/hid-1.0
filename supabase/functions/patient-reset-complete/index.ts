import { createAdminClient } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { sendPatientPasswordResetConfirmation } from '../_shared/notifications.ts'
import { completePatientPasswordResetChallenge } from '../_shared/otp.ts'
import { asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  challengeId: string
  password: string
  verificationToken: string
}

function isStrongPassword(value: string) {
  return value.length >= 8 &&
    value.length <= 20 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const challengeId = asTrimmedString(body.challengeId, 'challengeId')
  const password = asTrimmedString(body.password, 'password')
  const verificationToken = asTrimmedString(body.verificationToken, 'verificationToken')

  if (!isStrongPassword(password)) {
    throw new HttpError(400, 'Choose a stronger password before continuing.')
  }

  const adminClient = createAdminClient()
  const challenge = await completePatientPasswordResetChallenge(adminClient, {
    challengeId,
    newPassword: password,
    verificationToken,
  })

  const { data: patient, error } = await adminClient
    .from('hid_patients')
    .select('id, user_profile_id, hid_code, full_name, phone_e164, email')
    .eq('id', challenge.patient_id)
    .maybeSingle()

  if (error || !patient) {
    throw new HttpError(500, error?.message ?? 'Password updated, but the patient profile could not be loaded.', error)
  }

  await adminClient.from('hid_notifications').insert({
    user_profile_id: patient.user_profile_id,
    patient_id: patient.id,
    title: 'Password updated',
    message: 'Your HID account password was changed successfully.',
    type: 'security',
  })

  await adminClient.from('hid_audit_events').insert({
    actor_user_id: challenge.auth_user_id,
    patient_id: patient.id,
    resource_type: 'auth',
    action: 'patient_password_reset_completed',
    reason: 'Patient password reset completed with OTP verification.',
    metadata: {
      challenge_id: challenge.id,
    },
  })

  await sendPatientPasswordResetConfirmation({
    email: patient.email,
    hidCode: patient.hid_code,
    patientName: patient.full_name,
  })

  return json({
    data: {
      challengeId,
      status: 'completed',
    },
  })
}))
