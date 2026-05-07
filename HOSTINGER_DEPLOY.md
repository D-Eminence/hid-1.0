# Hostinger Notes

The active app is currently deployed through Vercel + Cloudflare. Keep this document for:

- Hostinger mailbox setup
- domain ownership tasks
- a fallback static-hosting path if needed later

## 1. Build With Production Frontend Env

Set the real values in `.env` before building:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Then build:

```bash
npm install
npm run build
```

## 2. Upload The Static Build

Upload the contents of `dist/` into `public_html/` on Hostinger.

Important:

- upload the contents of `dist/`, not the `dist` folder itself
- keep `.htaccess` in `public_html/`

## 3. SPA Routing

This repo includes a root-level SPA fallback file that rewrites app routes back to `index.html`.

Required routes:

- `/`
- `/patient`
- `/patient/profile`
- `/patient/records`
- `/hospital`
- `/hospital/dashboard`

## 4. Supabase Dashboard

Before testing production:

- set `Site URL` to `https://healthidentitydirectory.com`
- add redirect URLs for:
  - `https://healthidentitydirectory.com/patient`
  - `https://healthidentitydirectory.com/hospital/auth`
- enable Email auth
- disable Phone auth
- configure custom SMTP with Brevo or your active mail provider
- keep OTP-based verification enabled

## 5. Retest After Upload

1. Open `/patient`
2. Sign up with a fresh email and verify by OTP
3. Sign in with the same HID or email and password
4. Open `/hospital/auth`
5. Sign up a hospital account and verify by OTP
6. Sign in with hospital email and password
