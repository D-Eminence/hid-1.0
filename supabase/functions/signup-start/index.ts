import { createAdminClient } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { sendSignupVerificationCode } from '../_shared/notifications.ts'
import { createSignupChallenge, signupOtpTtlMinutes } from '../_shared/otp.ts'
import { loadPlatformControls } from '../_shared/platform.ts'
import { verifyTurnstileToken } from '../_shared/turnstile.ts'
import { asTrimmedString, normalizePhone, optionalTrimmedString } from '../_shared/validation.ts'

type AccountType = 'patient' | 'hospital'

type PatientSignupPayload = {
  firstName?: string
  lastName?: string
  gender?: string | null
  dob?: string | null
  phone?: string | null
}

type StaffSignupPayload = {
  country?: string | null
  fullName?: string | null
  hospitalName?: string | null
  licenseNumber?: string | null
  onboardingType?: 'hospital_signup' | 'staff_invite' | null
  phone?: string | null
  state?: string | null
}

type Payload = {
  accountType?: AccountType
  email?: string
  patient?: PatientSignupPayload
  staff?: StaffSignupPayload
  turnstileToken?: string | null
}

type AuthSignupStateRow = {
  auth_user_id: string
  email_confirmed: boolean
  phone_confirmed: boolean
  has_patient: boolean
  has_staff: boolean
}

type ProfileStateRow = {
  app_role: string | null
  deleted_at: string | null
  id: string
}

const INFORMATION_IN_USE = 'The information has already been used, Try to sign in.'

function looksLikeEmail(value: string) {
  return /\S+@\S+\.\S+/.test(value.trim())
}

function randomHex(length: number) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function temporaryPassword() {
  return `HidTmp!${randomHex(18)}a1`
}

function challengeTypeFor(accountType: AccountType) {
  return accountType === 'hospital' ? 'hospital_signup' as const : 'patient_signup' as const
}

function roleFor(accountType: AccountType) {
  return accountType === 'hospital' ? 'org_admin' : 'patient'
}

async function authSignupState(adminClient: ReturnType<typeof createAdminClient>, email: string) {
  const result = await adminClient.rpc('hid_auth_email_signup_state', {
    p_email: email,
  })

  if (result.error) {
    throw new HttpError(400, 'We could not verify this email right now.', result.error)
  }

  return (Array.isArray(result.data) ? result.data[0] : result.data) as AuthSignupStateRow | null
}

async function profileState(adminClient: ReturnType<typeof createAdminClient>, authUserId: string) {
  const result = await adminClient
    .from('hid_user_profiles')
    .select('id, app_role, deleted_at')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (result.error) {
    throw new HttpError(400, 'We could not verify this email right now.', result.error)
  }

  return (result.data ?? null) as ProfileStateRow | null
}

async function assertPatientPhoneAvailable(adminClient: ReturnType<typeof createAdminClient>, phone: string | null) {
  if (!phone) return

  const result = await adminClient
    .from('hid_patients')
    .select('id', { head: true, count: 'exact' })
    .eq('phone_e164', phone)
    .limit(1)

  if (result.error) {
    throw new HttpError(400, 'We could not verify this phone number right now.', result.error)
  }

  if ((result.count ?? 0) > 0) {
    throw new HttpError(409, INFORMATION_IN_USE)
  }
}

async function createOrReusePendingAuthUser(
  adminClient: ReturnType<typeof createAdminClient>,
  params: {
    accountType: AccountType
    displayName: string
    email: string
    userMetadata: Record<string, unknown>
  },
) {
  const targetRole = roleFor(params.accountType)
  const existing = await authSignupState(adminClient, params.email)

  if (existing?.auth_user_id) {
    if (existing.has_patient || existing.has_staff) {
      throw new HttpError(409, INFORMATION_IN_USE)
    }

    const profile = await profileState(adminClient, existing.auth_user_id)
    if (!profile) {
      const deleteResult = await adminClient.auth.admin.deleteUser(existing.auth_user_id)
      if (deleteResult.error) {
        throw new HttpError(400, 'We could not refresh this signup attempt right now.', deleteResult.error)
      }
    } else if (profile.deleted_at || (profile.app_role && profile.app_role !== targetRole)) {
      throw new HttpError(409, INFORMATION_IN_USE)
    } else {
      const updateResult = await adminClient.auth.admin.updateUserById(existing.auth_user_id, {
        app_metadata: {
          app_role: targetRole,
        },
        email_confirm: true,
        password: temporaryPassword(),
        user_metadata: params.userMetadata,
      })

      if (updateResult.error) {
        throw new HttpError(400, updateResult.error.message, updateResult.error)
      }

      await adminClient
        .from('hid_user_profiles')
        .update({
          active: true,
          app_role: targetRole,
          display_name: params.displayName,
          mfa_required: targetRole !== 'patient',
        })
        .eq('auth_user_id', existing.auth_user_id)

      return existing.auth_user_id
    }
  }

  const createResult = await adminClient.auth.admin.createUser({
    app_metadata: {
      app_role: targetRole,
    },
    email: params.email,
    email_confirm: true,
    password: temporaryPassword(),
    user_metadata: params.userMetadata,
  })

  if (createResult.error || !createResult.data.user?.id) {
    const message = createResult.error?.message ?? 'The account could not be created right now.'
    if (message.toLowerCase().includes('already')) {
      throw new HttpError(409, INFORMATION_IN_USE, createResult.error)
    }
    throw new HttpError(400, message, createResult.error)
  }

  return createResult.data.user.id
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const accountType: AccountType = body.accountType === 'hospital' ? 'hospital' : 'patient'
  const email = asTrimmedString(body.email, 'email').toLowerCase()

  if (!looksLikeEmail(email)) {
    throw new HttpError(400, 'Enter a valid email address first.')
  }

  await verifyTurnstileToken(req, body.turnstileToken ?? null, accountType === 'hospital' ? 'staff-signup' : 'patient-signup')

  const adminClient = createAdminClient()
  const controls = await loadPlatformControls(adminClient)
  if (controls.maintenance_mode) {
    throw new HttpError(503, 'HID is under scheduled maintenance right now. Please try again shortly.')
  }
  if (accountType === 'patient' && !controls.patient_signup_enabled) {
    throw new HttpError(403, 'Patient sign-up is disabled right now.')
  }
  if (accountType === 'hospital' && !controls.hospital_signup_enabled) {
    throw new HttpError(403, 'Hospital sign-up is disabled right now.')
  }

  let displayName = ''
  let metadata: Record<string, unknown>

  if (accountType === 'patient') {
    const patient = body.patient ?? {}
    const firstName = asTrimmedString(patient.firstName, 'firstName')
    const lastName = asTrimmedString(patient.lastName, 'lastName')
    const phone = normalizePhone(patient.phone)
    await assertPatientPhoneAvailable(adminClient, phone)

    displayName = `${firstName} ${lastName}`.trim()
    metadata = {
      full_name: displayName,
      pending_patient_signup: {
        dob: optionalTrimmedString(patient.dob),
        email,
        firstName,
        gender: optionalTrimmedString(patient.gender),
        lastName,
        phone,
      },
      requested_role: 'patient',
    }
  } else {
    const staff = body.staff ?? {}
    const hospitalName = asTrimmedString(staff.hospitalName, 'hospitalName')
    const state = asTrimmedString(staff.state, 'state')
    const country = asTrimmedString(staff.country, 'country')
    displayName = optionalTrimmedString(staff.fullName) ?? `${hospitalName} Admin`
    metadata = {
      full_name: displayName,
      pending_staff_onboarding: {
        country,
        fullName: displayName,
        hospitalName,
        licenseNumber: optionalTrimmedString(staff.licenseNumber),
        onboardingType: staff.onboardingType === 'staff_invite' ? 'staff_invite' : 'hospital_signup',
        phone: normalizePhone(staff.phone),
        state,
      },
      requested_role: 'org_admin',
    }
  }

  const authUserId = await createOrReusePendingAuthUser(adminClient, {
    accountType,
    displayName,
    email,
    userMetadata: metadata,
  })

  const challenge = await createSignupChallenge(adminClient, {
    authUserId,
    challengeType: challengeTypeFor(accountType),
    deliveryChannels: ['email'],
    deliverySummary: {
      email,
    },
    metadata: {
      account_type: accountType,
    },
  })

  const deliveries = await sendSignupVerificationCode({
    accountLabel: accountType === 'hospital' ? 'hospital account' : 'HID account',
    code: challenge.code,
    email,
    expiresInMinutes: signupOtpTtlMinutes(),
  })

  await adminClient.from('hid_audit_events').insert({
    actor_user_id: authUserId,
    resource_type: 'auth',
    action: accountType === 'hospital' ? 'hospital_signup_otp_sent' : 'patient_signup_otp_sent',
    reason: 'Signup verification code sent.',
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
