import { createAdminClient, requireRole } from '../_shared/auth.ts'
import { optionalEnv } from '../_shared/env.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asTrimmedString, optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  organizationId: string
  facilityId?: string | null
  email: string
  membershipRole: 'doctor' | 'nurse' | 'lab' | 'pharmacist' | 'admin'
  appRole?: 'clinician' | 'org_admin'
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireRole(req, ['org_admin', 'platform_admin'])
  const body = await readJson<Payload>(req)

  const organizationId = asTrimmedString(body.organizationId, 'organizationId')
  const email = asTrimmedString(body.email, 'email').toLowerCase()
  const membershipRole = asTrimmedString(body.membershipRole, 'membershipRole')
  const appRole = body.appRole === 'org_admin' ? 'org_admin' : 'clinician'

  const { data, error } = await client.rpc('hid_issue_staff_invite', {
    p_organization_id: organizationId,
    p_facility_id: optionalTrimmedString(body.facilityId),
    p_email: email,
    p_membership_role: membershipRole,
    p_app_role: appRole,
  })

  if (error) throw new HttpError(400, error.message, error)

  const adminClient = createAdminClient()
  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: {
      requested_role: appRole,
      membership_role: membershipRole,
    },
    redirectTo: optionalEnv('HID_STAFF_INVITE_REDIRECT_TO', 'http://localhost:5173/hospital'),
  })

  return json({
    data,
    inviteEmailStatus: inviteError ? 'failed' : 'sent',
    inviteEmailError: inviteError?.message ?? null,
  }, inviteError ? 202 : 201)
}))
