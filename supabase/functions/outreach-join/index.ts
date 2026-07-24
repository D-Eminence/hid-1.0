// Invite code = verification. Workers skip email OTP and go straight to dashboard.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const OUTREACH_INVITE_COLUMNS = 'id, campaign_id, role, use_count, max_uses, expires_at'
const OUTREACH_WORKER_COLUMNS = 'id, auth_user_id, campaign_id, display_name, role, created_at'

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function assertOutreachSignupEnabled(db: ReturnType<typeof adminClient>) {
  const { data, error } = await db
    .from('hid_platform_controls')
    .select('maintenance_mode, outreach_signup_enabled')
    .eq('id', true)
    .maybeSingle()

  if (error) throw new HttpError(400, error.message, error)
  if (data?.maintenance_mode) throw new HttpError(503, 'HID is under scheduled maintenance right now. Please try again shortly.')
  if (data && data.outreach_signup_enabled === false) {
    throw new HttpError(403, 'Outreach onboarding is temporarily disabled right now.')
  }
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const body = await readJson<Record<string, unknown>>(req)

  const code = (typeof body.code === 'string' ? body.code.replace(/-/g, '').toUpperCase().trim() : '')
  const email = (typeof body.email === 'string' ? body.email.trim().toLowerCase() : '')
  const password = (typeof body.password === 'string' ? body.password.trim() : '')
  const displayName = (typeof body.displayName === 'string' ? body.displayName.trim() : '')

  if (!code) throw new HttpError(422, 'Invite code is required.')
  if (!email || !/\S+@\S+\.\S+/.test(email)) throw new HttpError(422, 'Please enter a valid email address.')
  if (!password || password.length < 8) throw new HttpError(422, 'Password must be at least 8 characters.')
  if (!displayName) throw new HttpError(422, 'Your name is required.')

  try {
    const db = adminClient()
    await assertOutreachSignupEnabled(db)

    // Validate invite code
    const { data: invite, error: invErr } = await db
      .from('hid_outreach_invites')
      .select(OUTREACH_INVITE_COLUMNS)
      .eq('code', code)
      .maybeSingle()

    if (invErr || !invite) {
      throw new HttpError(404, 'This invite code is not valid. Please check the link and try again.', invErr)
    }
    if (invite.use_count >= invite.max_uses) {
      throw new HttpError(409, 'This invite link has reached its limit. Ask your campaign admin for a new one.')
    }
    if (invite.expires_at && new Date(invite.expires_at as string) < new Date()) {
      throw new HttpError(410, 'This invite link has expired. Ask your campaign admin for a new one.')
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
        throw new HttpError(409, 'An account with this email already exists. Please sign in at /outreach/login instead.')
      }
      console.error(JSON.stringify({ event: 'join_create_user_failed', error: createErr.message }))
      throw new HttpError(500, "We couldn't create your account right now. Please try again.", createErr)
    }

    if (!created?.user?.id) {
      throw new HttpError(500, "We couldn't create your account right now. Please try again.")
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
      throw new HttpError(500, "Your account was created but we couldn't link you to the campaign. Please try again.", workerErr)
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
      throw new HttpError(502, "Account created but sign-in failed. Please go to /outreach/login.", authData)
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

    return json({
      data: {
        session: {
          access_token: authData.access_token,
          refresh_token: authData.refresh_token,
          expires_in: authData.expires_in,
          token_type: authData.token_type ?? 'bearer',
        },
        worker,
      },
    })
  } catch (e) {
    if (e instanceof HttpError) throw e
    console.error(JSON.stringify({ event: 'unhandled_error', error: String(e) }))
    throw new HttpError(500, 'Something went wrong. Please try again.', e)
  }
}))
