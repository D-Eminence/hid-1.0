import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, withErrorHandling } from '../_shared/http.ts'
import { sendAccountDeletionCode } from '../_shared/notifications.ts'
import { accountDeletionOtpTtlMinutes, createAccountDeletionChallenge } from '../_shared/otp.ts'

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { user } = await requireUser(req)
  const adminClient = createAdminClient()

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
    .select('id, full_name, hid_code')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (patientResult.error) throw new HttpError(400, patientResult.error.message, patientResult.error)

  const staffResult = await adminClient
    .from('hid_staff_accounts')
    .select('id, full_name, hospital_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (staffResult.error) throw new HttpError(400, staffResult.error.message, staffResult.error)

  const email = user.email?.trim().toLowerCase() ?? null
  if (!email) {
    throw new HttpError(400, 'This account does not have an email address for verification.')
  }

  const patient = patientResult.data as { id: string; full_name: string | null; hid_code: string | null } | null
  const staff = staffResult.data as { id: string; full_name: string | null; hospital_name: string | null } | null

  const accountLabel = patient?.hid_code
    ? `HID account ${patient.hid_code}`
    : (staff?.hospital_name?.trim() ? `${staff.hospital_name.trim()} hospital account` : 'HID account')

  const challenge = await createAccountDeletionChallenge(adminClient, {
    authUserId: user.id,
    deliveryChannels: ['email'],
    deliverySummary: {
      maskedEmail: email,
    },
    metadata: {
      account_label: accountLabel,
    },
    patientId: patient?.id ?? null,
  })

  const deliveries = await sendAccountDeletionCode({
    accountLabel,
    code: challenge.code,
    email,
    expiresInMinutes: accountDeletionOtpTtlMinutes(),
  })

  await adminClient.from('hid_notifications').insert({
    user_profile_id: profileResult.data.id,
    patient_id: patient?.id ?? null,
    title: 'Account deletion code requested',
    message: 'A verification code was sent to your email address to confirm account deletion.',
    type: 'security',
  })

  await adminClient.from('hid_audit_events').insert({
    actor_user_id: user.id,
    actor_profile_id: profileResult.data.id,
    actor_role: profileResult.data.app_role,
    patient_id: patient?.id ?? null,
    resource_type: 'auth',
    action: 'account_deletion_requested',
    reason: 'Account deletion code requested.',
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
      maskedEmail: deliveries.receipts.find(item => item.channel === 'email')?.maskedTarget ?? null,
    },
  })
}))
