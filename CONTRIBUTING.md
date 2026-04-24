# Contributing To HID

This repository is set up so collaborator work should be reviewed in pull requests before anything reaches production.

## Branching Model

- `main` is the production branch.
- Do not push feature work directly to `main`.
- Create a branch from `main` for every change.
- Use clear branch names such as `feat/patient-auth-copy`, `fix/admin-lock-message`, or `security/turnstile-hardening`.

## Review Flow

1. Create a branch from `main`.
2. Make the change.
3. Open a pull request into `main`.
4. Wait for GitHub Actions to finish:
   - `CI`
   - `Deploy Preview`
5. Review the PR diff and the preview deployment.
6. Merge only after approval and passing checks.
7. Merging to `main` triggers the production Vercel deploy workflow.

## Required GitHub Settings

These settings must be enabled in GitHub because they cannot be fully enforced from code alone:

1. Open `Settings -> Branches -> Add rule` for `main`.
2. Enable `Require a pull request before merging`.
3. Enable at least `1` approving review.
4. Enable `Dismiss stale pull request approvals when new commits are pushed`.
5. Enable `Require status checks to pass before merging`.
6. Add the required checks from these workflows:
   - the `CI` workflow
   - the `Deploy Preview` workflow
7. Enable `Restrict who can push to matching branches` if you want to block direct pushes.

## What Reviewers Should Inspect

- The GitHub diff.
- The preview deployment linked by the PR workflow.
- Any auth, role, RLS, or Edge Function change with extra care.
- Changes to:
  - `src/lib/hidApi.ts`
  - `src/pages/`
  - `supabase/functions/`
  - `supabase/migrations/`
  - `supabase/config.toml`
  - `vercel.json`

## Local Checks Before Opening A PR

Run these from the repo root:

```bash
npm ci
npm run build
npm run security:audit
```

If you touched Supabase SQL or Edge Functions, also review:

- `supabase/config.toml`
- `supabase/migrations/`
- `supabase/functions/`

## Deploy Rules

- Pull requests deploy previews only.
- `main` deploys to production.
- Production deploys should only happen from reviewed code merged into `main`.

## Project Boundaries

Collaborators should treat these as the active product:

- `src/`
- `supabase/`
- `vercel.json`
- `.github/workflows/`

These are legacy or compatibility paths and should not be treated as the main product unless explicitly needed:

- `client/`
- `server/`
- `api/send-email.js`

## Secrets

- Never commit secrets.
- Frontend production values live in Vercel project envs.
- Backend/runtime secrets live in Supabase secrets.
- Canonical Turnstile names are:
  - `VITE_TURNSTILE_SITE_KEY`
  - `HID_TURNSTILE_SECRET_KEY`

Compatibility fallbacks exist for the currently provisioned names:

- `HID` in Vercel
- `TURNSTILE_SECRET_KEY` in Supabase

Use the canonical names for all new setup going forward.
