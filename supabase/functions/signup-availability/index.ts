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
  const controls = await loadPlatformControls(adminClient)

  if (!email && !phone) {
    throw new HttpError(400, 'Provide an email address or phone number to check.')
  }

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
    const authStateResult = await adminClient.rpc('hid_auth_email_signup_state', {
      p_email: email,
    })

    if (authStateResult.error) {
      throw new HttpError(400, 'We could not verify this email right now.', authStateResult.error)
    }

    const authState = (Array.isArray(authStateResult.data) ? authStateResult.data[0] : authStateResult.data) as AuthSignupStateRow | null

    if (authState?.auth_user_id) {
      const isOrphanUnverified = !authState.email_confirmed && !authState.phone_confirmed && !authState.has_patient && !authState.has_staff

      if (isOrphanUnverified) {
        const deleteResult = await adminClient.auth.admin.deleteUser(authState.auth_user_id)
        if (deleteResult.error) {
          throw new HttpError(400, 'We could not verify this email right now.', deleteResult.error)
        }
      } else {
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
    const phoneResult = await adminClient
      .from('hid_patients')
      .select('id', { head: true, count: 'exact' })
      .eq('phone_e164', phone)
      .limit(1)

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
