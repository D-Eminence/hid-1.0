import { createAdminClient } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { loadPlatformControls } from '../_shared/platform.ts'
import { optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  accountType?: 'patient' | 'hospital'
  email?: string | null
  phone?: string | null
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
}

function normalizePhone(value: string | null | undefined) {
  return `${value ?? ''}`.replace(/[^0-9+]/g, '').trim()
}

function looksLikeEmail(value: string | null | undefined) {
  return /\S+@\S+\.\S+/.test(`${value ?? ''}`.trim())
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const accountType = body.accountType === 'hospital' ? 'hospital' : 'patient'
  const email = optionalTrimmedString(body.email)?.toLowerCase() ?? null
  const phone = normalizePhone(body.phone)
  const adminClient = createAdminClient()
  const controlsPromise = loadPlatformControls(adminClient)
  const emailSignupStatePromise = email
    ? adminClient.rpc('hid_auth_email_signup_state', {
        p_email: email,
      })
    : null
  const phoneAvailabilityPromise = phone && accountType === 'patient'
    ? adminClient
        .from('hid_patients')
        .select('id', { head: true, count: 'exact' })
        .eq('phone_e164', phone)
        .limit(1)
    : null

  if (!email && !phone) {
    throw new HttpError(400, 'Provide an email address or phone number to check.')
  }

  const controls = await controlsPromise

  if (controls.maintenance_mode) {
    throw new HttpError(503, 'HID is under scheduled maintenance right now. Please try again shortly.')
  }

  if (accountType === 'patient' && !controls.patient_signup_enabled) {
    throw new HttpError(403, 'Patient sign-up is disabled right now.')
  }

  if (accountType === 'hospital' && !controls.hospital_signup_enabled) {
    throw new HttpError(403, 'Hospital sign-up is disabled right now.')
  }

  if (email && !looksLikeEmail(email)) {
    throw new HttpError(400, 'Enter a valid email address first.')
  }

  let emailInUse = false
  let emailOwner: 'patient' | 'hospital' | 'account' | null = null

  if (email) {
    const authStateResult = await emailSignupStatePromise!

    if (authStateResult.error) {
      throw new HttpError(400, 'We could not verify this email right now.', authStateResult.error)
    }

    const authState = (Array.isArray(authStateResult.data) ? authStateResult.data[0] : authStateResult.data) as AuthSignupStateRow | null

    if (authState?.auth_user_id) {
      const targetRole = accountType === 'hospital' ? 'org_admin' : 'patient'
      const profileResult = await adminClient
        .from('hid_user_profiles')
        .select('app_role, deleted_at')
        .eq('auth_user_id', authState.auth_user_id)
        .maybeSingle()

      if (profileResult.error) {
        throw new HttpError(400, 'We could not verify this email right now.', profileResult.error)
      }

      const profile = (profileResult.data ?? null) as ProfileStateRow | null
      const isCompletedAccount = authState.has_patient || authState.has_staff
      const isReusablePendingSignup = !isCompletedAccount && !profile?.deleted_at && (!profile?.app_role || profile.app_role === targetRole)

      if (!profile && !isCompletedAccount) {
        const deleteResult = await adminClient.auth.admin.deleteUser(authState.auth_user_id)
        if (deleteResult.error) {
          throw new HttpError(400, 'We could not verify this email right now.', deleteResult.error)
        }
      } else if (!isReusablePendingSignup) {
        emailInUse = true
        emailOwner = authState.has_patient
          ? 'patient'
          : authState.has_staff
            ? 'hospital'
            : 'account'
      }
    }
  }

  let phoneInUse = false
  if (phone && accountType === 'patient') {
    const phoneResult = await phoneAvailabilityPromise!

    if (phoneResult.error) {
      throw new HttpError(400, 'We could not verify this phone number right now.', phoneResult.error)
    }

    phoneInUse = (phoneResult.count ?? 0) > 0
  }

  return json({
    data: {
      accountType,
      emailInUse,
      emailOwner,
      phoneInUse,
    },
  })
}))
