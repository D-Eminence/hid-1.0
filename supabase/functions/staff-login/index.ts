import { createAdminClient } from '../_shared/auth.ts'
import { requireEnv } from '../_shared/env.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { loadPlatformControls } from '../_shared/platform.ts'
import { verifyTurnstileToken } from '../_shared/turnstile.ts'
import { asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  email?: string | null
  password?: string | null
  turnstileToken?: string | null
}

type UserProfileState = {
  app_role: string
  active: boolean
  deleted_at: string | null
}

type StaffAccountState = {
  active: boolean
  deleted_at: string | null
}

const supabaseUrl = requireEnv('SUPABASE_URL')
const supabaseAnonKey = requireEnv('SUPABASE_ANON_KEY')

function authErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Invalid hospital credentials.'

  const candidate = payload as Record<string, unknown>
  if (typeof candidate.msg === 'string' && candidate.msg.trim()) return candidate.msg
  if (typeof candidate.error_description === 'string' && candidate.error_description.trim()) return candidate.error_description
  if (typeof candidate.error === 'string' && candidate.error.trim()) return candidate.error

  return 'Invalid hospital credentials.'
}

async function authenticateWithCredential(email: string, password: string) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.access_token || !data?.refresh_token || !data?.user?.id) {
    throw new HttpError(401, authErrorMessage(data))
  }

  return data
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Payload>(req)
  const email = asTrimmedString(body.email, 'email').toLowerCase()
  const password = asTrimmedString(body.password, 'password')

  await verifyTurnstileToken(req, body.turnstileToken ?? null, 'staff-login')

  const adminClient = createAdminClient()
  const controlsPromise = loadPlatformControls(adminClient)
  const dataPromise = authenticateWithCredential(email, password)

  const controls = await controlsPromise
  if (controls.maintenance_mode) {
    throw new HttpError(503, 'HID is under scheduled maintenance right now. Please try again shortly.')
  }
  if (!controls.hospital_portal_enabled) {
    throw new HttpError(503, 'The hospital portal is temporarily unavailable right now.')
  }

  const data = await dataPromise
  const authUserId = `${data.user?.id ?? ''}`.trim()

  if (authUserId) {
    const [profileResult, staffResult] = await Promise.all([
      adminClient
        .from('hid_user_profiles')
        .select('app_role, active, deleted_at')
        .eq('auth_user_id', authUserId)
        .maybeSingle(),
      adminClient
        .from('hid_staff_accounts')
        .select('active, deleted_at')
        .eq('auth_user_id', authUserId)
        .maybeSingle(),
    ])

    if (profileResult.error) {
      throw new HttpError(400, 'We could not verify this account right now.', profileResult.error)
    }
    if (staffResult.error) {
      throw new HttpError(400, 'We could not verify this account right now.', staffResult.error)
    }

    const profile = (profileResult.data ?? null) as UserProfileState | null
    const staffAccount = (staffResult.data ?? null) as StaffAccountState | null

    if (profile?.deleted_at || staffAccount?.deleted_at) {
      throw new HttpError(403, 'This account has been deleted and is no longer available.')
    }
    if (profile?.active === false || staffAccount?.active === false) {
      throw new HttpError(403, 'This account is locked right now. Contact support if you need help.')
    }
    if (profile && profile.app_role !== 'clinician' && profile.app_role !== 'org_admin') {
      throw new HttpError(401, 'Invalid hospital credentials.')
    }
  }

  return json({
    data: {
      session: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        expires_at: data.expires_at,
        token_type: data.token_type,
        user: data.user,
      },
    },
  })
}))
