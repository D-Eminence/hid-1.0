// Self-contained — deploy this single file via Supabase Dashboard.
// Invite code = verification. Workers skip email OTP and go straight to dashboard.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const OUTREACH_INVITE_COLUMNS = 'id, campaign_id, role, use_count, max_uses, expires_at'
const OUTREACH_WORKER_COLUMNS = 'id, auth_user_id, campaign_id, display_name, role, created_at'

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function ok(data: unknown) {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

async function assertOutreachSignupEnabled(db: ReturnType<typeof adminClient>) {
  const { data, error } = await db
    .from('hid_platform_controls')
    .select('maintenance_mode, outreach_signup_enabled')
    .eq('id', true)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (data?.maintenance_mode) return err(503, 'HID is under scheduled maintenance right now. Please try again shortly.')
  if (data && data.outreach_signup_enabled === false) {
    return err(403, 'Outreach onboarding is temporarily disabled right now.')
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return err(405, 'Method not allowed.')

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err(400, 'Invalid request body.') }

  const code = (typeof body.code === 'string' ? body.code.replace(/-/g, '').toUpperCase().trim() : '')
  const email = (typeof body.email === 'string' ? body.email.trim().toLowerCase() : '')
  const password = (typeof body.password === 'string' ? body.password.trim() : '')
  const displayName = (typeof body.displayName === 'string' ? body.displayName.trim() : '')

  if (!code) return err(400, 'Invite code is required.')
  if (!email || !/\S+@\S+\.\S+/.test(email)) return err(400, 'Please enter a valid email address.')
  if (!password || password.length < 8) return err(400, 'Password must be at least 8 characters.')
  if (!displayName) return err(400, 'Your name is required.')

  try {
    const db = adminClient()
    const controlError = await assertOutreachSignupEnabled(db)
    if (controlError) return controlError

    // Validate invite code
    const { data: invite, error: invErr } = await db
      .from('hid_outreach_invites')
      .select(OUTREACH_INVITE_COLUMNS)
      .eq('code', code)
      .maybeSingle()

    if (invErr || !invite) {
      return err(400, 'This invite code is not valid. Please check the link and try again.')
    }
    if (invite.use_count >= invite.max_uses) {
      return err(400, 'This invite link has reached its limit. Ask your campaign admin for a new one.')
    }
    if (invite.expires_at && new Date(invite.expires_at as string) < new Date()) {
      return err(400, 'This invite link has expired. Ask your campaign admin for a new one.')
    }

    // Create auth user — email_confirm: true means no email verification needed
    // The invite code itself is the verification
    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createErr) {
      if (createErr.status === 422 || createErr.message?.toLowerCase().includes('already been registered')) {
        return err(409, 'An account with this email already exists. Please sign in at /outreach/login instead.')
      }
      console.error(JSON.stringify({ event: 'join_create_user_failed', error: createErr.message }))
      return err(500, "We couldn't create your account right now. Please try again.")
    }

    if (!created?.user?.id) {
      return err(500, "We couldn't create your account right now. Please try again.")
    }

    const authUserId = created.user.id

    // Create worker record
    const { data: worker, error: workerErr } = await db
      .from('hid_outreach_workers')
      .insert({
        auth_user_id: authUserId,
        campaign_id: invite.campaign_id,
        display_name: displayName,
        role: invite.role ?? 'enumerator',
      })
      .select(OUTREACH_WORKER_COLUMNS)
      .single()

    if (workerErr || !worker) {
      // Clean up auth user if worker creation fails
      await db.auth.admin.deleteUser(authUserId).catch(() => undefined)
      console.error(JSON.stringify({ event: 'join_create_worker_failed', error: workerErr?.message }))
      return err(500, "Your account was created but we couldn't link you to the campaign. Please try again.")
    }

    // Sign in to get a live session
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const authData = await authRes.json().catch(() => null)

    if (!authRes.ok || !authData?.access_token) {
      console.error(JSON.stringify({ event: 'join_sign_in_failed', auth_user_id: authUserId }))
      return err(500, "Account created but sign-in failed. Please go to /outreach/login.")
    }

    // Increment invite use count (non-blocking)
    db.from('hid_outreach_invites')
      .update({ use_count: (invite.use_count as number) + 1 })
      .eq('id', invite.id)
      .then(() => undefined)
      .catch(() => undefined)

    // Log event
    db.from('hid_outreach_auth_log')
      .insert({ event: 'worker_joined', email, auth_user_id: authUserId, worker_id: worker.id, campaign_id: invite.campaign_id, metadata: { invite_code: code } })
      .then(() => undefined)
      .catch(() => undefined)

    console.log(JSON.stringify({ event: 'worker_joined', email, campaign_id: invite.campaign_id, role: invite.role }))

    return ok({
      session: {
        access_token: authData.access_token,
        refresh_token: authData.refresh_token,
        expires_in: authData.expires_in,
        token_type: authData.token_type ?? 'bearer',
      },
      worker,
    })
  } catch (e) {
    console.error(JSON.stringify({ event: 'unhandled_error', error: String(e) }))
    return err(500, 'Something went wrong. Please try again.')
  }
})
