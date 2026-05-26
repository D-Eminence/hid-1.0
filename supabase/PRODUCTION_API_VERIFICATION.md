# Production API Verification

Use this checklist after deploying the API performance changes in this release.

## Pre-deploy

- `npm run build`
- `npm audit --audit-level=high`
- `supabase db push`
- Deploy changed functions:
  - `patient-login`
  - `patients-records`
  - `staff-login`
  - `audit-list`
  - `admin-platform-controls`
  - `admin-role-management`

## High-priority smoke checks

### Patient login

- Sign in with email and password.
- Sign in with HID code and password.
- Sign in with phone and password when phone auth is configured.
- Confirm invalid credentials still return the same user-facing error.

### Hospital login

- Sign in with a valid hospital account.
- Confirm locked staff accounts are still blocked.
- Confirm non-hospital users are still rejected.

### Patient records

- Open a patient with a valid active grant.
- Confirm records still load.
- Confirm attached files still return signed download URLs.
- Confirm a patient access notification is still created.
- Confirm the audit event for record access is still written.

### Audit history

- Open patient history.
- Open hospital history.
- Confirm recent events are visible and ordered correctly.

### Admin role management

- Open admin overview and load the admin/RBAC panel.
- Confirm the admin list includes email, last sign-in, and MFA status.
- Change one hospital role permission and refresh immediately.
- Confirm the updated RBAC setting is reflected without waiting for cache expiry.

### Admin platform controls

- Open platform controls.
- Toggle one control.
- Refresh immediately.
- Confirm the updated control value is reflected without waiting for cache expiry.

## Post-deploy monitoring

- Watch function logs for:
  - `patient-login`
  - `patients-records`
  - `staff-login`
  - `admin-role-management`
  - `admin-platform-controls`
- Confirm no spike in:
  - `403` access errors
  - `400` RPC errors
  - storage signing warnings
  - auth verification failures
