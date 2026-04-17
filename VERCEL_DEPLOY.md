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
VITE_SENTRY_DSN=your-public-sentry-dsn
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_POSTHOG_KEY=your-posthog-project-api-key
VITE_POSTHOG_HOST=https://eu.i.posthog.com
```

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
- `/admin/login`
- `/admin/overview`

## After First Deploy

1. Verify the temporary Vercel URL works.
2. Add the custom domain in Vercel.
3. Point DNS from Cloudflare to the Vercel-provided records.
4. Update Supabase:
   - `Site URL`
   - auth redirect URLs
   - `HID_ALLOWED_ORIGIN`
   - custom SMTP / OTP email provider settings

## Important

Before production, [supabase/.env.production](/home/l2e/V1/hid-unified-package/supabase/.env.production) must not keep:

```env
HID_ALLOWED_ORIGIN=http://localhost:3000
```

Replace it with your real frontend origins and push secrets again, for example:

```env
HID_ALLOWED_ORIGIN=https://healthidentitydirectory.com,https://www.healthidentitydirectory.com
```
