# Production Repair

Use this only if the hosted Supabase project drifts from the repo and signup or signin starts failing.

## 1. Link The Repo

```bash
supabase link --project-ref tywuujyqpqrlnweezxul
```

## 2. Push Migrations

```bash
supabase db push
```

## 3. Set Required Secrets

```bash
supabase secrets set --env-file ./supabase/.env.production
```

For the current fast-launch path, these must exist:

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

## 4. Deploy Functions

```bash
supabase functions deploy --project-ref tywuujyqpqrlnweezxul
```

## 5. Check Dashboard Auth Settings

For the current launch path:

1. Email auth enabled
2. Phone auth disabled
3. Site URL set to the real frontend domain
4. Redirect URLs include:
   - `https://your-domain.com/patient`
   - `https://your-domain.com/hospital`
5. Email confirmations off unless SMTP is already configured
6. Turnstile left off unless intentionally enabled later

## 6. Quick Smoke Test

1. Patient:
   - sign up with a fresh email and password
   - sign in with the same email and password
   - request password reset and verify the email code arrives
2. Hospital:
   - sign up with hospital name, email, phone, state, country, and password
   - sign in with hospital name, email, and password

## 7. If A Hospital User Already Exists

Check whether the auth user exists without a matching `hid_staff_accounts` row:

```sql
select
  u.id as auth_user_id,
  u.email,
  u.email_confirmed_at,
  s.id as staff_account_id,
  s.hospital_name,
  s.verification_status
from auth.users u
left join public.hid_staff_accounts s on s.auth_user_id = u.id
where lower(u.email) = lower('replace-with-hospital-email@example.com');
```

If the auth user exists and `staff_account_id` is `null`, sign in again after migrations and functions are repaired. That should complete onboarding. If it does not, delete the bad test auth user and sign up again.
