import { createAdminClient } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  accountType?: 'patient' | 'hospital'
  email?: string | null
  phone?: string | null
}

type EmailOwner = 'patient' | 'hospital' | 'unknown' | null

type AuthEmailSignupStateRow = {
  auth_user_id: string
  email_confirmed: boolean
  has_patient: boolean
  has_staff: boolean
  phone_confirmed: boolean
}

type DeleteAccountResponse = {
  deleted?: boolean
}

function normalizePhone(value: string | null | undefined) {
  return `${value ?? ''}`.replace(/[^0-9+]/g, '').trim()
}

function looksLikeEmail(value: string | null | undefined) {
  return /\S+@\S+\.\S+/.test(`${value ?? ''}`.trim())
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const adminClient = createAdminClient()
  const body = await readJson<Payload>(req)
  const accountType = body.accountType === 'hospital' ? 'hospital' : 'patient'
  const email = optionalTrimmedString(body.email)?.toLowerCase() ?? null
  const phone = normalizePhone(body.phone)

  if (!email && !phone) {
    throw new HttpError(400, 'Provide an email address or phone number to check.')
  }

  if (email && !looksLikeEmail(email)) {
    throw new HttpError(400, 'Enter a valid email address first.')
  }

  const [
    authEmailStateResult,
    patientEmailResult,
    staffEmailResult,
    patientPhoneResult,
  ] = await Promise.all([
    email
      ? adminClient.rpc('hid_auth_email_signup_state', { p_email: email })
      : Promise.resolve({ data: null, error: null }),
    email
      ? adminClient.from('hid_patients').select('id').eq('email', email).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    email
      ? adminClient.from('hid_staff_accounts').select('id').eq('email', email).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    phone
      ? adminClient.from('hid_patient_identifiers').select('patient_id').eq('identifier_type', 'phone').eq('normalized_value', phone).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (authEmailStateResult.error) throw new HttpError(400, authEmailStateResult.error.message, authEmailStateResult.error)
  if (patientEmailResult.error) throw new HttpError(400, patientEmailResult.error.message, patientEmailResult.error)
  if (staffEmailResult.error) throw new HttpError(400, staffEmailResult.error.message, staffEmailResult.error)
  if (patientPhoneResult.error) throw new HttpError(400, patientPhoneResult.error.message, patientPhoneResult.error)

  const patientEmailInUse = Boolean(patientEmailResult.data)
  const staffEmailInUse = Boolean(staffEmailResult.data)
  const authEmailState = Array.isArray(authEmailStateResult.data)
    ? (authEmailStateResult.data[0] as AuthEmailSignupStateRow | undefined) ?? null
    : (authEmailStateResult.data as AuthEmailSignupStateRow | null)
  const shouldRecycleOrphanedSignup =
    Boolean(authEmailState?.auth_user_id) &&
    !authEmailState?.email_confirmed &&
    !authEmailState?.phone_confirmed &&
    !authEmailState?.has_patient &&
    !authEmailState?.has_staff &&
    !patientEmailInUse &&
    !staffEmailInUse

  if (shouldRecycleOrphanedSignup && authEmailState?.auth_user_id) {
    const { data, error } = await adminClient.rpc('hid_delete_account_by_auth_user_id', {
      p_auth_user_id: authEmailState.auth_user_id,
    })
    if (error) {
      throw new HttpError(500, 'We could not refresh this unfinished signup right now. Please try again.', error)
    }

    const deleted = Boolean((data as DeleteAccountResponse | null)?.deleted)
    if (!deleted) {
      const fallback = await adminClient.auth.admin.deleteUser(authEmailState.auth_user_id)
      if (fallback.error) {
        throw new HttpError(500, 'We could not refresh this unfinished signup right now. Please try again.', fallback.error)
      }
    }
  }

  const authEmailInUse = Boolean(authEmailState?.auth_user_id) && !shouldRecycleOrphanedSignup

  let emailOwner: EmailOwner = null
  if (patientEmailInUse) emailOwner = 'patient'
  else if (staffEmailInUse) emailOwner = 'hospital'
  else if (authEmailInUse) emailOwner = 'unknown'

  const phoneInUse = Boolean(patientPhoneResult.data)

  return json({
    data: {
      accountType,
      emailInUse: authEmailInUse || patientEmailInUse || staffEmailInUse,
      emailOwner,
      phoneInUse,
    },
  })
}))
