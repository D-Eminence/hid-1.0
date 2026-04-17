import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { optionalEnv } from './env.ts'
import { HttpError } from './http.ts'

const PASSWORD_RESET_CHALLENGE = 'patient_password_reset'

type AuthChallengeRow = {
  id: string
  auth_user_id: string
  attempt_count: number
  challenge_type: string
  consumed_at: string | null
  delivery_channels: string[]
  delivery_summary: Record<string, unknown>
  expires_at: string
  max_attempts: number
  metadata: Record<string, unknown>
  otp_hash: string
  patient_id: string
  verification_token_expires_at: string | null
  verification_token_hash: string | null
  verified_at: string | null
}

function parsePositiveInt(value: string | null | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function otpLength() {
  return parsePositiveInt(optionalEnv('HID_PASSWORD_RESET_OTP_LENGTH', '6'), 6, 4, 10)
}

export function passwordResetOtpTtlMinutes() {
  return parsePositiveInt(optionalEnv('HID_PASSWORD_RESET_OTP_TTL_MINUTES', '10'), 10, 5, 30)
}

function maxAttempts() {
  return parsePositiveInt(optionalEnv('HID_PASSWORD_RESET_MAX_ATTEMPTS', '5'), 5, 3, 10)
}

function pepper() {
  return optionalEnv('HID_OTP_PEPPER', 'hid-dev-otp-pepper')
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string) {
  const input = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return toHex(new Uint8Array(digest))
}

async function hashSecret(value: string) {
  return sha256(`${pepper()}:${value}`)
}

function nowIso() {
  return new Date().toISOString()
}

function isExpired(value: string | null | undefined) {
  if (!value) return true
  return new Date(value).getTime() <= Date.now()
}

function generateDigits(length: number) {
  const values = new Uint8Array(length)
  crypto.getRandomValues(values)
  return Array.from(values, value => `${value % 10}`).join('')
}

function generateVerificationToken() {
  const values = new Uint8Array(24)
  crypto.getRandomValues(values)
  return toHex(values)
}

async function fetchChallenge(adminClient: SupabaseClient, challengeId: string) {
  const { data, error } = await adminClient
    .from('hid_auth_challenges')
    .select('id, patient_id, auth_user_id, challenge_type, otp_hash, attempt_count, max_attempts, expires_at, verified_at, verification_token_hash, verification_token_expires_at, consumed_at, delivery_channels, delivery_summary, metadata')
    .eq('id', challengeId)
    .eq('challenge_type', PASSWORD_RESET_CHALLENGE)
    .maybeSingle()

  if (error || !data) {
    throw new HttpError(400, 'The password reset challenge could not be found.')
  }

  return data as AuthChallengeRow
}

export async function createPatientPasswordResetChallenge(
  adminClient: SupabaseClient,
  params: {
    authUserId: string
    deliveryChannels: Array<'sms' | 'email'>
    deliverySummary: Record<string, unknown>
    metadata?: Record<string, unknown>
    patientId: string
  }
) {
  const length = otpLength()
  const code = generateDigits(length)
  const expiresAt = new Date(Date.now() + passwordResetOtpTtlMinutes() * 60 * 1000).toISOString()

  await adminClient
    .from('hid_auth_challenges')
    .update({
      consumed_at: nowIso(),
    })
    .eq('auth_user_id', params.authUserId)
    .eq('challenge_type', PASSWORD_RESET_CHALLENGE)
    .is('consumed_at', null)

  const { data, error } = await adminClient
    .from('hid_auth_challenges')
    .insert({
      auth_user_id: params.authUserId,
      challenge_type: PASSWORD_RESET_CHALLENGE,
      delivery_channels: params.deliveryChannels,
      delivery_summary: params.deliverySummary,
      metadata: params.metadata ?? {},
      expires_at: expiresAt,
      max_attempts: maxAttempts(),
      otp_hash: await hashSecret(code),
      otp_length: length,
      patient_id: params.patientId,
    })
    .select('id, expires_at')
    .single()

  if (error || !data) {
    throw new HttpError(500, error?.message ?? 'Unable to create the password reset challenge.', error)
  }

  return {
    challengeId: data.id as string,
    code,
    expiresAt: data.expires_at as string,
  }
}

export async function verifyPatientPasswordResetChallenge(
  adminClient: SupabaseClient,
  challengeId: string,
  code: string
) {
  const challenge = await fetchChallenge(adminClient, challengeId)
  if (challenge.consumed_at) {
    throw new HttpError(400, 'This password reset session has already been used.')
  }
  if (isExpired(challenge.expires_at)) {
    throw new HttpError(400, 'This password reset code has expired.')
  }
  if (challenge.attempt_count >= challenge.max_attempts) {
    throw new HttpError(429, 'Too many incorrect verification attempts. Start again to get a new code.')
  }

  const incomingHash = await hashSecret(code)
  if (incomingHash !== challenge.otp_hash) {
    await adminClient
      .from('hid_auth_challenges')
      .update({
        attempt_count: challenge.attempt_count + 1,
      })
      .eq('id', challenge.id)

    throw new HttpError(400, 'The verification code is not correct.')
  }

  const verificationToken = generateVerificationToken()
  const verificationTokenHash = await hashSecret(verificationToken)

  const { error } = await adminClient
    .from('hid_auth_challenges')
    .update({
      attempt_count: challenge.attempt_count,
      verification_token_expires_at: challenge.expires_at,
      verification_token_hash: verificationTokenHash,
      verified_at: nowIso(),
    })
    .eq('id', challenge.id)

  if (error) {
    throw new HttpError(500, error.message, error)
  }

  return {
    challenge,
    verificationToken,
  }
}

export async function completePatientPasswordResetChallenge(
  adminClient: SupabaseClient,
  params: {
    challengeId: string
    newPassword: string
    verificationToken: string
  }
) {
  const challenge = await fetchChallenge(adminClient, params.challengeId)
  if (challenge.consumed_at) {
    throw new HttpError(400, 'This password reset session has already been used.')
  }
  if (isExpired(challenge.expires_at)) {
    throw new HttpError(400, 'This password reset code has expired.')
  }
  if (!challenge.verified_at || !challenge.verification_token_hash) {
    throw new HttpError(400, 'Verify the password reset code before choosing a new password.')
  }
  if (isExpired(challenge.verification_token_expires_at)) {
    throw new HttpError(400, 'This password reset session has expired. Start again to get a new code.')
  }

  const tokenHash = await hashSecret(params.verificationToken)
  if (tokenHash !== challenge.verification_token_hash) {
    throw new HttpError(400, 'This password reset session is not valid anymore.')
  }

  const { error: updateError } = await adminClient.auth.admin.updateUserById(challenge.auth_user_id, {
    password: params.newPassword,
  })

  if (updateError) {
    throw new HttpError(400, updateError.message, updateError)
  }

  const { error } = await adminClient
    .from('hid_auth_challenges')
    .update({
      consumed_at: nowIso(),
      verification_token_expires_at: null,
      verification_token_hash: null,
    })
    .eq('id', challenge.id)

  if (error) {
    throw new HttpError(500, error.message, error)
  }

  return challenge
}
