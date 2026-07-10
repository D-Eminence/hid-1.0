import { createAdminClient, requireRole } from '../_shared/auth.ts'
import { sendTransactionalEmail } from '../_shared/email.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import {
  adminExportOtpTtlMinutes,
  consumeAdminExportChallenge,
  createAdminExportChallenge,
  verifyAdminExportChallenge,
} from '../_shared/otp.ts'
import { asTrimmedString } from '../_shared/validation.ts'
import {
  buildAdminUsersExportFile,
  loadAdminUsersExportRows,
  type AdminUsersExportFilters,
  type AdminUsersExportFormat,
} from '../_shared/admin-user-export.ts'

type Payload = {
  action?: 'download' | 'start'
  challengeId?: string
  code?: string
  format?: AdminUsersExportFormat
  filters?: Partial<AdminUsersExportFilters>
}

const EXPORT_SCOPES: AdminUsersExportFilters['scope'][] = [
  'selected_user',
  'search_results',
  'selected_day',
  'last_7_days',
  'last_30_days',
  'all',
]

function normalizeFilters(input?: Partial<AdminUsersExportFilters>) {
  const scope = EXPORT_SCOPES.includes(`${input?.scope ?? 'all'}` as AdminUsersExportFilters['scope'])
    ? `${input?.scope ?? 'all'}` as AdminUsersExportFilters['scope']
    : 'all'

  return {
    scope,
    authUserId: input?.authUserId?.trim() || null,
    query: input?.query?.trim() || null,
    date: input?.date?.trim() || null,
  } satisfies AdminUsersExportFilters
}

function validateFilters(filters: AdminUsersExportFilters) {
  if (filters.scope === 'selected_user' && !filters.authUserId) {
    throw new HttpError(400, 'Choose a user to export first.')
  }
  if (filters.scope === 'search_results' && !filters.query) {
    throw new HttpError(400, 'Enter a HID code or email to export first.')
  }
  if (filters.scope === 'selected_day' && !filters.date) {
    throw new HttpError(400, 'Choose a date to export first.')
  }
}

function maskEmailAddress(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  const [localPart, domainPart] = trimmed.split('@')
  if (!localPart || !domainPart) return trimmed
  if (localPart.length <= 2) return `${localPart[0] ?? '*'}***@${domainPart}`
  return `${localPart.slice(0, 2)}***@${domainPart}`
}

function renderExportEmail(format: AdminUsersExportFormat, code: string, expiresInMinutes: number) {
  const formatLabel = format.toUpperCase()
  return `
    <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#111827">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
        <div style="padding:24px 28px;background:#1a6fd4;color:#ffffff">
          <div style="font-size:24px;font-weight:700">Confirm HID export</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px">Health Identity Directory</div>
        </div>
        <div style="padding:28px">
          <p style="margin:0 0 12px;font-size:14px">Hello,</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.7">
            Use the code below to approve your ${formatLabel} user export.
          </p>
          <div style="margin:0 0 18px;padding:18px;border:1px dashed #93c5fd;border-radius:12px;background:#eff6ff;text-align:center">
            <div style="font-size:12px;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px">Verification Code</div>
            <div style="font-size:30px;font-weight:700;letter-spacing:0.24em;color:#1a6fd4">${code}</div>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.7">
            This code expires in ${expiresInMinutes} minutes. If you did not request this export, you can ignore this message.
          </p>
        </div>
      </div>
    </div>
  `
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const auth = await requireRole(req, ['platform_admin'])
  const adminClient = createAdminClient()
  const body = await readJson<Payload>(req)
  const action = asTrimmedString(body.action, 'action')

  if (action === 'start') {
    const format = asTrimmedString(body.format, 'format').toLowerCase() as AdminUsersExportFormat
    if (!['csv', 'xlsx', 'pdf', 'txt'].includes(format)) {
      throw new HttpError(400, 'Choose a valid export format first.')
    }
    const filters = normalizeFilters(body.filters)
    validateFilters(filters)

    const email = auth.user.email?.trim().toLowerCase() ?? null
    if (!email) {
      throw new HttpError(400, 'This account does not have an email address for export verification.')
    }

    const challenge = await createAdminExportChallenge(adminClient, {
      authUserId: auth.user.id,
      deliveryChannels: ['email'],
      deliverySummary: {
        maskedEmail: maskEmailAddress(email),
      },
      metadata: {
        export_format: format,
        filters,
      },
    })

    await sendTransactionalEmail(
      email,
      'Your HID export verification code',
      renderExportEmail(format, challenge.code, adminExportOtpTtlMinutes()),
    )

    const auditResult = await adminClient.from('hid_audit_events').insert({
      actor_user_id: auth.user.id,
      actor_profile_id: auth.profile?.id ?? null,
      actor_role: auth.role,
      resource_type: 'admin_export',
      action: 'admin_user_export_requested',
      reason: 'Admin export code requested.',
      metadata: {
        challenge_id: challenge.challengeId,
        export_format: format,
      },
    })
    if (auditResult.error) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'Failed to record admin export request audit event.',
        error: auditResult.error.message,
      }))
    }

    return json({
      data: {
        challengeId: challenge.challengeId,
        deliveryChannels: ['email' as const],
        expiresAt: challenge.expiresAt,
        maskedEmail: maskEmailAddress(email),
      },
    })
  }

  if (action === 'download') {
    const challengeId = asTrimmedString(body.challengeId, 'challengeId')
    const code = asTrimmedString(body.code, 'code')
    const requestedFormat = asTrimmedString(body.format, 'format').toLowerCase() as AdminUsersExportFormat
    if (!['csv', 'xlsx', 'pdf', 'txt'].includes(requestedFormat)) {
      throw new HttpError(400, 'Choose a valid export format first.')
    }
    const requestedFilters = normalizeFilters(body.filters)

    const verified = await verifyAdminExportChallenge(adminClient, challengeId, code, auth.user.id)
    const exportFormat = `${verified.challenge.metadata?.export_format ?? ''}`.trim().toLowerCase() as AdminUsersExportFormat
    if (exportFormat !== requestedFormat) {
      throw new HttpError(400, 'This export format no longer matches the verification code. Start again to get a new code.')
    }

    const exportFilters = normalizeFilters(
      (verified.challenge.metadata?.filters as Partial<AdminUsersExportFilters> | undefined) ?? requestedFilters,
    )
    validateFilters(exportFilters)

    await consumeAdminExportChallenge(adminClient, {
      authUserId: auth.user.id,
      challengeId,
      verificationToken: verified.verificationToken,
    })

    const rows = await loadAdminUsersExportRows(adminClient, exportFilters)
    const file = await buildAdminUsersExportFile(rows, exportFormat)

    const auditResult = await adminClient.from('hid_audit_events').insert({
      actor_user_id: auth.user.id,
      actor_profile_id: auth.profile?.id ?? null,
      actor_role: auth.role,
      resource_type: 'admin_export',
      action: 'admin_user_export_completed',
      reason: 'Admin export downloaded.',
      metadata: {
        challenge_id: challengeId,
        export_format: exportFormat,
        row_count: rows.length,
      },
    })
    if (auditResult.error) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'Failed to record admin export completion audit event.',
        error: auditResult.error.message,
      }))
    }

    return new Response(file.bytes, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Content-Type': file.contentType,
        'X-File-Name': file.fileName,
      },
    })
  }

  throw new HttpError(400, 'Choose a valid export action first.')
}))
