# HID

Health Identity Directory is the main HID web app.

It is a React + Vite app connected to Supabase. Patients use it to manage their HID profile, records, notifications, and access history. Hospitals use it to sign in, request patient access, review records, and handle emergency access. Platform admin access lives under the private `/eminence` routes.

## Main Stack

- Frontend: React, Vite, React Router
- Backend: Supabase Postgres, Storage, and Edge Functions
- Hosting: Vercel
- DNS/CDN: Cloudflare
- Email: Brevo
- Monitoring: Sentry and PostHog
- Bot protection: Cloudflare Turnstile

## Important Folders

- `src/` is the active frontend app.
- `supabase/` contains migrations, config, and Edge Functions.
- `public/` contains static files like `robots.txt` and `sitemap.xml`.
- `vercel.json` contains production headers, rewrites, redirects, and SEO noindex rules.
- `.github/workflows/` contains CI, preview deploy, and production deploy workflows.

The old `client/`, `server/`, and `api/` folders are not the main product unless a task clearly says to work there.

## Live Routes

- `/` public landing page
- `/patient` patient sign in/sign up
- `/patient/profile`
- `/patient/records`
- `/patient/history`
- `/patient/notifications`
- `/hospital/auth`
- `/hospital/dashboard`
- `/hospital/access`
- `/hospital/history`
- `/hospital/emergency`
- `/eminence/login` private admin login
- `/eminence/overview` private admin dashboard

## Local Setup

Install dependencies:

```bash
npm install
```

Create `.env` with the frontend values:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_TURNSTILE_SITE_KEY=
VITE_SENTRY_DSN=
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://eu.i.posthog.com
```

Run locally:

```bash
npm run dev
```

## Commands I Use

```bash
npm run build
npm audit
npm run security:audit
npm run security:deps
```

`npm audit` is currently clean with `0 vulnerabilities`.

## Production Secrets

Frontend env values live in Vercel.

Supabase runtime secrets live in Supabase:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `HID_ALLOWED_ORIGIN`
- `HID_OTP_PEPPER`
- `BREVO_API_KEY`
- `BREVO_FROM_EMAIL`
- `BREVO_FROM_NAME`
- `SEND_EMAIL_HOOK_SECRET`
- `SEND_EMAIL_HOOK_TOKEN`
- `HID_TURNSTILE_SECRET_KEY`

Use this origin allowlist in production:

```env
HID_ALLOWED_ORIGIN=https://healthidentitydirectory.com,https://www.healthidentitydirectory.com
```

## Deploy

Production deploys from `main`.

The production workflow runs:

1. `npm ci`
2. `npm run security:audit`
3. `npm run build`
4. Vercel production build
5. Vercel production deploy

Pull requests into `main` create Vercel preview deploys.

## Google SEO

Only the public landing page should be indexed by Google:

```text
https://healthidentitydirectory.com/
```

The sitemap only lists the home page.

Private/auth routes are marked with `X-Robots-Tag: noindex, nofollow` in `vercel.json`, including:

- `/patient`
- `/patient/*`
- `/hospital`
- `/hospital/*`
- `/doctor/*`
- `/eminence`
- `/eminence/*`
- `/admin`
- `/admin/*`

After deploy, verify:

```bash
curl -I https://healthidentitydirectory.com
curl -I https://healthidentitydirectory.com/patient
curl -I https://healthidentitydirectory.com/eminence/login
curl -sS https://healthidentitydirectory.com/robots.txt
curl -sS https://healthidentitydirectory.com/sitemap.xml
```

In Google Search Console:

1. Submit `https://healthidentitydirectory.com/sitemap.xml`.
2. Inspect `https://healthidentitydirectory.com/`.
3. Request indexing for the home page.
4. Confirm private routes are excluded by `noindex`.

## Collaboration

The repo is private.

Admins can push directly to `main`.

For collaborators, the safer setup is:

1. Add them with read access.
2. Let them fork the repo.
3. They create a branch in their fork.
4. They open a pull request into `main`.
5. Admin reviews and merges.

GitHub rulesets were created for `main`, but GitHub says they will not be enforced on this private repository unless it is moved to a GitHub Team organization account or made public.

Until then, do not rely on GitHub to block bad pushes. Keep write/admin access limited.

## Manual Checks Before Pushing

Before pushing important changes:

```bash
npm audit
npm run build
```

If Supabase migrations or Edge Functions changed, also check the related Supabase deploy steps before pushing frontend changes.

## Current Notes

- The active branch is `main`.
- The GitHub repo is `D-Eminence/hid-1.0`.
- Admin and auth routes are intentionally removed from Google indexing.
- Production deploy starts after pushing to `main`.
