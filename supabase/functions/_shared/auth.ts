import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import type { User } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { requireEnv } from './env.ts'
import { HttpError } from './http.ts'
import { assertPlatformPortalAccess } from './platform.ts'

const supabaseUrl = requireEnv('SUPABASE_URL')
const supabaseAnonKey = requireEnv('SUPABASE_ANON_KEY')
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
let adminClientSingleton: ReturnType<typeof createClient> | null = null

export function createUserClient(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new HttpError(401, 'Missing Authorization header.')

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export function createAdminClient() {
  if (adminClientSingleton) {
    return adminClientSingleton
  }

  adminClientSingleton = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return adminClientSingleton
}

type HidUserProfileRecord = {
  active: boolean
  app_role: string
  deleted_at: string | null
  display_name: string | null
  id: string
  mfa_required: boolean
}

type HidStaffAccountState = {
  active: boolean
  deleted_at: string | null
  id: string
  role: string
}

export async function requireUser(req: Request): Promise<{
  client: ReturnType<typeof createUserClient>
  user: User
  profile: HidUserProfileRecord | null
  staffAccount: HidStaffAccountState | null
}> {
  const authHeader = req.headers.get('Authorization')
  const accessToken = authHeader?.replace(/^Bearer\s+/i, '').trim() ?? ''
  const client = createUserClient(req)
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) {
    throw new HttpError(401, 'Authentication required.')
  }

  const profileResult = await client
    .from('hid_user_profiles')
    .select('id, app_role, active, deleted_at, display_name, mfa_required')
    .eq('auth_user_id', data.user.id)
    .maybeSingle()

  if (profileResult.error) {
    throw new HttpError(400, 'We could not verify this account right now.', profileResult.error)
  }

  const profile = (profileResult.data ?? null) as HidUserProfileRecord | null
  if (profile?.deleted_at) {
    throw new HttpError(403, 'This account has been deleted and is no longer available.')
  }
  if (profile?.active === false) {
    throw new HttpError(403, 'This account is locked right now. Contact support if you need help.')
  }

  const metadataRole = typeof data.user.app_metadata?.app_role === 'string' ? data.user.app_metadata.app_role as string : ''
  const effectiveRole = typeof profile?.app_role === 'string' ? profile.app_role : metadataRole
  const adminClient = createAdminClient()

  let staffAccount: HidStaffAccountState | null = null
  if (effectiveRole === 'clinician' || effectiveRole === 'org_admin') {
    const staffResult = await client
      .from('hid_staff_accounts')
      .select('id, active, deleted_at, role')
      .eq('auth_user_id', data.user.id)
      .maybeSingle()

    if (staffResult.error) {
      throw new HttpError(400, 'We could not verify this account right now.', staffResult.error)
    }

    staffAccount = (staffResult.data ?? null) as HidStaffAccountState | null
    if (staffAccount?.deleted_at) {
      throw new HttpError(403, 'This account has been deleted and is no longer available.')
    }
    if (staffAccount?.active === false) {
      throw new HttpError(403, 'This account is locked right now. Contact support if you need help.')
    }
  }

  if (effectiveRole) {
    await assertPlatformPortalAccess(adminClient, effectiveRole)
  }

  const shouldRequireMfa =
    Boolean(profile?.mfa_required) &&
    (
      effectiveRole === 'platform_admin' ||
      ((effectiveRole === 'clinician' || effectiveRole === 'org_admin') && Boolean(staffAccount?.id))
    )

  if (shouldRequireMfa) {
    const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel()
    if (assurance.error) {
      throw new HttpError(400, 'We could not verify this account right now.', assurance.error)
    }

    // Only block when the user has an enrolled second factor that still needs
    // to be completed for this session.
    if (assurance.data?.nextLevel === 'aal2' && assurance.data?.currentLevel !== 'aal2') {
      throw new HttpError(403, 'Multi-factor authentication is required for this account.')
    }
  }

  return { client, user: data.user, profile, staffAccount }
}

export async function requireRole(req: Request, allowedRoles: string[]) {
  const auth = await requireUser(req)
  let role = typeof auth.profile?.app_role === 'string'
    ? auth.profile.app_role
    : typeof auth.user.app_metadata?.app_role === 'string'
      ? auth.user.app_metadata.app_role as string
      : ''

  if (!allowedRoles.includes(role)) {
    const { data } = await auth.client
      .from('hid_user_profiles')
      .select('app_role')
      .eq('auth_user_id', auth.user.id)
      .maybeSingle()

    if (typeof data?.app_role === 'string') {
      role = data.app_role
    }
  }

  if (!allowedRoles.includes(role)) {
    throw new HttpError(403, 'You do not have permission to perform this action.')
  }

  return { ...auth, role }
}
