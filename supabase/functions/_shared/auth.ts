import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import type { User } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { requireEnv } from './env.ts'
import { HttpError } from './http.ts'

const supabaseUrl = requireEnv('SUPABASE_URL')
const supabaseAnonKey = requireEnv('SUPABASE_ANON_KEY')
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

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
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function requireUser(req: Request): Promise<{ client: ReturnType<typeof createUserClient>; user: User }> {
  const client = createUserClient(req)
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) {
    throw new HttpError(401, 'Authentication required.')
  }

  return { client, user: data.user }
}

export async function requireRole(req: Request, allowedRoles: string[]) {
  const auth = await requireUser(req)
  let role = typeof auth.user.app_metadata?.app_role === 'string' ? auth.user.app_metadata.app_role as string : ''

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
