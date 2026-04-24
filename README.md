# HID

Health Identity Directory is a React + Vite healthcare directory and records portal backed by hosted Supabase.

The live product path is:

- frontend: Vercel
- edge/backend: Supabase Edge Functions + Postgres + Storage
- CDN and DNS: Cloudflare
- email: Brevo

## Active Product

The active application in this repository is the root app, not the old workspaces.

Treat these as the real product:

- `src/`
- `supabase/`
- `public/`
- `vercel.json`
- `.github/workflows/`

These paths are legacy or compatibility-only unless a task explicitly says otherwise:

- `client/`
- `server/`
- `api/send-email.js`
- local Supabase Docker assumptions

## Live Routes

- `/`
- `/patient`
- `/patient/profile`
- `/patient/records`
- `/patient/history`
- `/hospital/auth`
- `/hospital/dashboard`
- `/hospital/access`
- `/hospital/history`
- `/hospital/emergency`
- `/eminence/login`
- `/eminence/overview`

## Product Flows

### Patient

- Sign up with email + password.
- Verify with 6-digit OTP.
- Sign in with HID code or email + password.
- Manage profile, records, notifications, and access history.
- Reset password through email OTP.

### Hospital

- Sign up a hospital/org-admin account with hospital details + email + password.
- Verify with 6-digit OTP.
- Sign in with hospital email + password.
- View dashboard, request patient access, use break-glass, and review history.

### Admin

- Manual sign-in at `/eminence/login`.
- MFA is required for privileged access.
- Account recovery uses email OTP.
- Dashboard supports user search, account actions, analytics, and security monitoring.

## Architecture

### Frontend

- React 18 + Vite 8
- React Router
- Supabase JS client
- Sentry + PostHog
- Cloudflare Turnstile on public auth flows

### Backend

- Hosted Supabase project
- Postgres with migrations in `supabase/migrations/`
- Edge Functions in `supabase/functions/`
- Signed file upload and download flows for medical record attachments

### Storage

- Medical record files are stored in Supabase Storage.
- Upload registration is server-bound to signed upload metadata.
- Patient record reads no longer expose raw storage paths to the frontend.

## Security Highlights

- `npm audit` is currently clean with `0 vulnerabilities`.
- Public auth flows are protected with Cloudflare Turnstile outside local development.
- Privileged access is MFA-gated in the application flow.
- Vercel headers include CSP, HSTS, frame protections, referrer policy, and related hardening.
- Patient record file registration is path-bound and hardened against re-binding attacks.
- Supabase config is production-aligned in [supabase/config.toml](/home/l2e/V1/hid-unified-package/supabase/config.toml:1).

## Repository Map

- App shell and routes: [src/App.tsx](/home/l2e/V1/hid-unified-package/src/App.tsx:1)
- Shared HID client logic: [src/lib/hidApi.ts](/home/l2e/V1/hid-unified-package/src/lib/hidApi.ts:1)
- Patient auth: [src/pages/patient/PatientAuth.tsx](/home/l2e/V1/hid-unified-package/src/pages/patient/PatientAuth.tsx:1)
- Hospital auth: [src/pages/doctor/DoctorAuth.tsx](/home/l2e/V1/hid-unified-package/src/pages/doctor/DoctorAuth.tsx:1)
- Admin auth: [src/pages/admin/AdminLogin.tsx](/home/l2e/V1/hid-unified-package/src/pages/admin/AdminLogin.tsx:1)
- Admin dashboard service layer: [src/services/adminDashboard.ts](/home/l2e/V1/hid-unified-package/src/services/adminDashboard.ts:1)
- UI primitives: [src/components/ui.tsx](/home/l2e/V1/hid-unified-package/src/components/ui.tsx:1)
- Turnstile widget: [src/components/TurnstileWidget.tsx](/home/l2e/V1/hid-unified-package/src/components/TurnstileWidget.tsx:1)
- Supabase config: [supabase/config.toml](/home/l2e/V1/hid-unified-package/supabase/config.toml:1)
- Supabase functions: [supabase/functions](/home/l2e/V1/hid-unified-package/supabase/functions)
- Supabase migrations: [supabase/migrations](/home/l2e/V1/hid-unified-package/supabase/migrations)
- Vercel deploy notes: [VERCEL_DEPLOY.md](/home/l2e/V1/hid-unified-package/VERCEL_DEPLOY.md:1)
- Collaboration guide: [CONTRIBUTING.md](/home/l2e/V1/hid-unified-package/CONTRIBUTING.md:1)

## Local Setup

1. Install dependencies.
2. Create `.env`.
3. Run the Vite app.

```bash
npm install
npm run dev
```

## Frontend Env

Set these before building:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_TURNSTILE_SITE_KEY=your-cloudflare-turnstile-site-key
VITE_SENTRY_DSN=your-public-sentry-dsn
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_POSTHOG_KEY=your-posthog-project-api-key
VITE_POSTHOG_HOST=https://eu.i.posthog.com
```

Compatibility note:

- The frontend currently also accepts a Vercel env named `HID` as a fallback for the Turnstile site key.
- Use `VITE_TURNSTILE_SITE_KEY` for all new setup.

## Supabase Secrets

Required runtime secrets for the hosted path:

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
- `SEND_EMAIL_HOOK_TOKEN`
- `HID_TURNSTILE_SECRET_KEY`

Compatibility note:

- The backend currently also accepts `TURNSTILE_SECRET_KEY` as a fallback.
- Use `HID_TURNSTILE_SECRET_KEY` for all new setup.

Recommended production origin allowlist:

```env
HID_ALLOWED_ORIGIN=https://healthidentitydirectory.com,https://www.healthidentitydirectory.com
```

## Common Commands

```bash
npm run dev
npm run build
npm run preview
npm run security:audit
npm run security:deps
```

## Collaborator Workflow

The intended release model is:

1. Collaborator creates a feature branch from `main`.
2. Collaborator opens a pull request into `main`.
3. GitHub Actions runs:
   - `CI`
   - `Deploy Preview`
4. You inspect:
   - the PR diff
   - the preview deployment URL
   - any migration or Supabase function change
5. After approval, merge to `main`.
6. Merge to `main` triggers production deploy.

Read the full guide in [CONTRIBUTING.md](/home/l2e/V1/hid-unified-package/CONTRIBUTING.md:1).

## GitHub Actions

- CI workflow: [.github/workflows/ci.yml](/home/l2e/V1/hid-unified-package/.github/workflows/ci.yml:1)
  Runs `npm ci`, `npm run security:audit`, and `npm run build`.
- Preview workflow: [.github/workflows/vercel-preview.yml](/home/l2e/V1/hid-unified-package/.github/workflows/vercel-preview.yml:1)
  Deploys a Vercel preview for pull requests targeting `main`.
- Production workflow: [.github/workflows/vercel-production.yml](/home/l2e/V1/hid-unified-package/.github/workflows/vercel-production.yml:1)
  Deploys production on merge/push to `main`.

## Important Manual GitHub Setting

To make collaborator review mandatory, enable branch protection on `main` in GitHub:

- Require pull requests before merging
- Require at least one approval
- Dismiss stale approvals on new commits
- Require status checks to pass
- Add the required checks from the `CI` and `Deploy Preview` workflows
- Optionally restrict direct pushes to `main`

This cannot be fully enforced from repository files alone, so it still needs to be turned on in GitHub settings.

## Deploy Notes

- Preview deploys are for PR inspection.
- Production deploys come from `main`.
- Supabase database changes must be pushed before or alongside frontend changes when they are coupled.
- Edge Functions that import shared helpers must be redeployed when those helpers change.

## Additional Docs

- Vercel deploy guide: [VERCEL_DEPLOY.md](/home/l2e/V1/hid-unified-package/VERCEL_DEPLOY.md:1)
- Supabase backend guide: [supabase/README.md](/home/l2e/V1/hid-unified-package/supabase/README.md:1)
- Admin dashboard setup notes: [ADMIN_DASHBOARD_SETUP.md](/home/l2e/V1/hid-unified-package/ADMIN_DASHBOARD_SETUP.md:1)
- Hostinger and DNS notes: [HOSTINGER_DEPLOY.md](/home/l2e/V1/hid-unified-package/HOSTINGER_DEPLOY.md:1)

## Troubleshooting

- If auth fails in hosted environments, verify Turnstile env names first.
- If a privileged user signs in but cannot continue, check MFA enrollment state and `platform_admin` role assignment.
- If record attachments fail, review the signed upload/register flow in `files-sign-upload` and `files-register-upload`.
- If CI passes but prod behaves differently, verify Vercel production envs and Supabase secrets, not just local `.env`.

## Current State

- Build is passing locally.
- Security audit is clean locally.
- Production Supabase auth config has already been repaired and the latest file-path hardening migration has been applied.
