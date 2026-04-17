# HID Admin Dashboard Setup

This project now includes an admin overview route at `/eminence/overview`.

## What The Admin Dashboard Uses

- Frontend: Vite app hosted on Vercel
- Backend: Supabase Edge Function `admin-dashboard-overview`
- Observability overview sources:
  - Sentry API
  - PostHog API

The dashboard will still load without Sentry and PostHog secrets, but those two panels will stay in setup mode until the secrets are added in Supabase.

## Frontend Env Vars For Vercel

Set these in Vercel for the web app:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_SENTRY_DSN=your_public_sentry_dsn
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_POSTHOG_KEY=your_posthog_project_api_key
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

## Supabase Secrets For Admin Overview

Set these in Supabase project secrets:

```env
SENTRY_AUTH_TOKEN=your_sentry_api_token
SENTRY_ORG_SLUG=your_sentry_org_slug
SENTRY_PROJECT_SLUG=your_sentry_project_slug
POSTHOG_PERSONAL_API_KEY=your_posthog_personal_api_key
POSTHOG_PROJECT_ID=your_posthog_project_id
```

Optional:

```env
SENTRY_BASE_URL=https://sentry.io
POSTHOG_HOST=https://us.posthog.com
```

## Deploy The Admin Edge Function

From the project root:

```bash
supabase functions deploy admin-dashboard-overview --project-ref YOUR_PROJECT_REF
```

## Promote A User To Platform Admin

The admin dashboard is currently restricted to users with `app_role = 'platform_admin'`.

Run this in the Supabase SQL editor after your target user account already exists:

```sql
update public.hid_user_profiles
set app_role = 'platform_admin'
where auth_user_id = (
  select id
  from auth.users
  where email = 'your-admin-email@example.com'
);
```

Then sign out and sign back in before opening `/admin`.

## What Shows Up Inside The Admin Dashboard

- Supabase user, provider, security, and record metrics
- Sentry unresolved issues, affected users, and recent issue list
- PostHog tracked events, unique users, top events, and trend

## Recommended Same-Day Deploy Order

1. Set the Vercel frontend env vars.
2. Set the Supabase secrets for Sentry and PostHog.
3. Deploy `admin-dashboard-overview`.
4. Promote your admin user to `platform_admin`.
5. Open `/eminence/overview` and verify the Sentry and PostHog panels show `Connected`.
