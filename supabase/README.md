# Supabase Backend

This folder contains the only backend used by the active app.

## Initial Launch Scope

Use the hosted Supabase project only.

Active auth model:

- patient signup: email + password
- patient signin: email + password
- patient phone: stored as patient data only
- hospital signup: hospital name + email + password
- hospital signin: hospital name + email + password

## Minimum Deploy Order

1. `supabase link --project-ref <your-project-ref>`
2. `supabase db push`
3. `supabase secrets set --env-file ./supabase/.env.production`
4. `supabase functions deploy --project-ref <your-project-ref>`

## Functions Used By The Active App

- `patient-register`
- `patient-reset-start`
- `patient-reset-verify`
- `patient-reset-complete`
- `staff-complete-onboarding`
- `patients-me`
- `patients-records`
- `records-create`
- `records-version-create`
- `access-request-create`
- `access-grant-revoke`
- `access-grant-close`
- `break-glass`
- `files-sign-upload`
- `files-register-upload`
- `files-sign-download`
- `notifications-list`
- `audit-list`
- `staff-dashboard`
- `patient-history-list`
- `health-check`

Compatibility-only, not used by the active frontend launch path:

- `patient-login`

## Required Secrets

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
- `HID_TURNSTILE_SECRET_KEY`

Optional later:

- `HID_STAFF_INVITE_REDIRECT_TO`

Compatibility fallback:

- The backend also accepts `TURNSTILE_SECRET_KEY` for the current hosted setup.
- Standardize on `HID_TURNSTILE_SECRET_KEY` for all new setup.

For production domains, set `HID_ALLOWED_ORIGIN` as a comma-separated allowlist instead of a single value:

```env
HID_ALLOWED_ORIGIN=https://your-domain.com,https://www.your-domain.com
```

## Dashboard Settings

- Email auth enabled
- Phone auth disabled
- Site URL set to the real frontend domain
- Redirect URLs include `/patient` and `/hospital`
- Email confirmation off for the fastest launch, unless SMTP is already configured

## Notes

- The active frontend is email-only for patient signin.
- Patient HID codes still exist, but they identify records, not auth sessions.
- Patient password reset still uses the backend email-code flow.
- Turnstile is required in hosted environments because auth and reset endpoints now fail closed when the secret is missing.
- Edge Function CORS headers are resolved per request origin from `HID_ALLOWED_ORIGIN`.
- Expired browser sessions are treated as auth failures and should cause the frontend to send the user back through sign-in instead of surfacing a generic failure.
