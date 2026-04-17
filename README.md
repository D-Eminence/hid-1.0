# HID

The active product in this repo is the root React + Vite app in `src/`, backed by the hosted Supabase project configured in `.env`.

## Active Architecture

- frontend: static Vite SPA from the repo root
- live hosting: Vercel, with the custom domain fronted by Cloudflare
- backend: hosted Supabase only
- transactional email: Brevo
- patient auth:
  - sign up with email + password
  - verify with a 6-digit OTP
  - sign in with HID code or email + password
- hospital auth:
  - sign up with hospital details + email + password
  - verify with a 6-digit OTP
  - sign in with hospital email + password
- admin auth:
  - manual sign in at `/admin/login`
  - password recovery by 6-digit OTP

Ignore these for the active product:

- local Supabase Docker stack
- the legacy `client/` workspace
- the legacy `server/` workspace
- phone OTP / SMS auth
- any old Resend-based email setup

## What Works

- landing page at `/`
- patient signup, OTP verification, signin, profile, records, notifications, and access history at `/patient`
- patient password reset by email OTP
- hospital signup, OTP verification, signin, dashboard, access, history, emergency, and patient-record flows at `/hospital`
- admin manual sign in and overview at `/admin/login` and `/admin/overview`
- Supabase RLS, storage signed URLs, and audit logging
- multi-file upload in patient and hospital record flows

## Production Hardening

- Supabase Edge Functions support multiple allowed origins through `HID_ALLOWED_ORIGIN`.
  Use a comma-separated list in production, for example:
  `https://healthidentitydirectory.com,https://www.healthidentitydirectory.com`
- Stale or expired browser sessions are cleared automatically when the backend returns an auth failure.
- User-facing errors are sanitized and normalized into explanatory messages without exposing stack traces, database internals, tokens, or secrets.
- Static assets are served with immutable cache headers through [vercel.json](/home/l2e/V1/hid-unified-package/vercel.json).
- View data for profile, records, history, and dashboard screens is short-lived cached in memory and invalidated after writes.
- Record creation uses request dedupe and in-flight submit guards to reduce duplicate saves on slow networks.
- The Vite dev server is locked to `127.0.0.1` to reduce local development exposure.

Architecture note:

- The active app is a static SPA backed directly by Supabase.
- Supabase manages browser auth sessions client-side in this model.
- Moving access tokens to `httpOnly` cookies would require a server-side auth proxy or SSR layer and is not part of the current architecture.

## Required Frontend Env

Create `.env` from `.env.example`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_SENTRY_DSN=your-public-sentry-dsn
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_POSTHOG_KEY=your-posthog-project-api-key
VITE_POSTHOG_HOST=https://eu.i.posthog.com
```

These values are baked into the static build, so set them before `npm run build`.

## Required Supabase Secrets

Create `supabase/.env.production` from `supabase/.env.production.example`.

Required for the current launch path:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `HID_ALLOWED_ORIGIN`
- `HID_OTP_PEPPER`
- `HID_PASSWORD_RESET_OTP_LENGTH`
- `HID_PASSWORD_RESET_OTP_TTL_MINUTES`
- `HID_PASSWORD_RESET_MAX_ATTEMPTS`
- `BREVO_API_KEY`
- `BREVO_FROM_EMAIL`
- `BREVO_FROM_NAME`
- `SEND_EMAIL_HOOK_SECRET`

Optional later:

- `HID_STAFF_INVITE_REDIRECT_TO`
- `HID_TURNSTILE_SECRET_KEY`
- observability backend secrets for Sentry and PostHog

Recommended production value for `HID_ALLOWED_ORIGIN`:

```env
HID_ALLOWED_ORIGIN=https://your-domain.com,https://www.your-domain.com
```

## Supabase Dashboard Settings

For the current production path:

- enable Email auth
- disable Phone auth
- keep patient and hospital verification on OTP by email
- set `Site URL` to your real frontend domain
- add redirect URLs for:
  - `https://your-domain.com/patient`
  - `https://your-domain.com/hospital/auth`
  - `https://your-domain.com/admin/login`

SMTP should point to Brevo.

## Deploy

- Vercel deploy steps: [VERCEL_DEPLOY.md](/home/l2e/V1/hid-unified-package/VERCEL_DEPLOY.md)
- Hostinger notes: [HOSTINGER_DEPLOY.md](/home/l2e/V1/hid-unified-package/HOSTINGER_DEPLOY.md)

The active live path is Vercel + Cloudflare. The Hostinger notes are still useful for mailbox and DNS-related setup.

## Local Commands

```bash
npm install
npm run dev
npm run build
npm run preview
npm run security:audit
```

## Security Audit Notes

- Current `npm audit` result is down to a Vite/esbuild development-server advisory.
- The remaining issue affects the local dev server, not the production static build.
- Upgrading to Vite `8.x` is the fix path, but that is a breaking upgrade and should be handled as a separate planned change.

## Version Control

- local git is initialized in this repo on branch `main`
- to finish GitHub setup, add a remote and push:

```bash
git remote add origin <your-github-repo-url>
git add .
git commit -m "Initial HID application import"
git push -u origin main
```

## Important Files

- frontend app: `src/`
- patient + hospital auth client: [src/lib/hidApi.ts](/home/l2e/V1/hid-unified-package/src/lib/hidApi.ts)
- patient auth page: [src/pages/patient/PatientAuth.tsx](/home/l2e/V1/hid-unified-package/src/pages/patient/PatientAuth.tsx)
- hospital auth page: [src/pages/doctor/DoctorAuth.tsx](/home/l2e/V1/hid-unified-package/src/pages/doctor/DoctorAuth.tsx)
- admin login page: [src/pages/admin/AdminLogin.tsx](/home/l2e/V1/hid-unified-package/src/pages/admin/AdminLogin.tsx)
- Supabase config: [supabase/config.toml](/home/l2e/V1/hid-unified-package/supabase/config.toml)
- Vercel deploy notes: [VERCEL_DEPLOY.md](/home/l2e/V1/hid-unified-package/VERCEL_DEPLOY.md)
