# Vercel Deploy

This project should be deployed to Vercel from the repository root:

`/home/l2e/V1/hid-unified-package`

## Build Settings

- Framework preset: `Vite`
- Build command: `npm run build`
- Output directory: `dist`

## Frontend Environment Variables

Set these in the Vercel project:

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

Compatibility fallback:

- The frontend also accepts a Vercel env named `HID` as a fallback for the Turnstile site key.
- Standardize on `VITE_TURNSTILE_SITE_KEY` for all new setup.

## Routing

This repo includes [vercel.json](/home/l2e/V1/hid-unified-package/vercel.json) so direct loads continue to work for:

- `/`
- `/patient`
- `/patient/profile`
- `/patient/records`
- `/patient/history`
- `/hospital`
- `/hospital/auth`
- `/hospital/dashboard`
- `/hospital/access`
- `/hospital/history`
- `/hospital/emergency`
- `/admin`
- `/eminence/login`
- `/eminence/overview`

## After First Deploy

1. Verify the temporary Vercel URL works.
2. Add the custom domain in Vercel.
3. Point DNS from Cloudflare to the Vercel-provided records.
4. Update Supabase:
   - `Site URL`
   - auth redirect URLs
   - `HID_ALLOWED_ORIGIN`
   - `HID_TURNSTILE_SECRET_KEY`
   - custom SMTP / OTP email provider settings

## Cloudflare Turnstile

Create a Cloudflare Turnstile widget for the production domains and set:

```env
VITE_TURNSTILE_SITE_KEY=your-cloudflare-turnstile-site-key
```

Then push the paired server secret to Supabase:

```bash
supabase secrets set HID_TURNSTILE_SECRET_KEY=your-cloudflare-turnstile-secret
```

The auth flows now fail closed outside local development if Turnstile is missing or misconfigured, which is intentional for production safety.

## Pull Request Preview Flow

- Pull requests into `main` use `.github/workflows/vercel-preview.yml`.
- Each PR gets a Vercel preview deployment for review before merge.
- Merging to `main` triggers the production deploy workflow.

## Important

Before production, [supabase/.env.production](/home/l2e/V1/hid-unified-package/supabase/.env.production) must not keep:

```env
HID_ALLOWED_ORIGIN=http://localhost:3000
```

Replace it with your real frontend origins and push secrets again, for example:

```env
HID_ALLOWED_ORIGIN=https://healthidentitydirectory.com,https://www.healthidentitydirectory.com
```
