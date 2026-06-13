import { sendTransactionalEmail } from './email.ts'
import { HttpError } from './http.ts'

export type DeliveryReceipt = {
  channel: 'email'
  maskedTarget: string
  provider: 'brevo'
}

type PasswordResetDeliveryInput = {
  code: string
  email: string | null
  expiresInMinutes: number
  hidCode: string
  patientName: string
}

type PasswordResetConfirmationInput = {
  email: string | null
  hidCode: string
  patientName: string
}

type PatientRegistrationDeliveryInput = {
  email: string | null
  hidCode: string
  patientName: string
}

type SignupVerificationDeliveryInput = {
  accountLabel: string
  code: string
  email: string | null
  expiresInMinutes: number
}

type AccountDeletionDeliveryInput = {
  accountLabel: string
  code: string
  email: string | null
  expiresInMinutes: number
}

type PatientRecordAccessAlertInput = {
  accessedAt: string
  accessType: string
  actorName: string
  email: string | null
  hidCode: string
  hospitalName: string | null
  patientName: string
}

type ShareInviteDeliveryInput = {
  email: string
  invitedName: string | null
  patientName: string
  permissionTierLabel: string
  durationLabel: string
  reason: string | null
}

function maskEmailAddress(value: string | null) {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  const [localPart, domainPart] = trimmed.split('@')
  if (!localPart || !domainPart) return trimmed
  if (localPart.length <= 2) return `${localPart[0] ?? '*'}***@${domainPart}`
  return `${localPart.slice(0, 2)}***@${domainPart}`
}

function renderPasswordResetEmail({
  code,
  expiresInMinutes,
  hidCode,
  patientName,
}: {
  code: string
  expiresInMinutes: number
  hidCode: string
  patientName: string
}) {
  return `
    <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#111827">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
        <div style="padding:24px 28px;background:#1a6fd4;color:#ffffff">
          <div style="font-size:24px;font-weight:700">HID Security</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px">Health Identity Directory</div>
        </div>
        <div style="padding:28px">
          <p style="margin:0 0 12px;font-size:14px">Hello ${patientName || 'there'},</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.7">
            A password reset was requested for your HID account ${hidCode}. Use the code below to continue.
          </p>
          <div style="margin:0 0 18px;padding:18px;border:1px dashed #93c5fd;border-radius:12px;background:#eff6ff;text-align:center">
            <div style="font-size:12px;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px">Verification Code</div>
            <div style="font-size:30px;font-weight:700;letter-spacing:0.24em;color:#1a6fd4">${code}</div>
          </div>
          <p style="margin:0 0 10px;font-size:14px;line-height:1.7">
            This code expires in ${expiresInMinutes} minutes. If you did not request this reset, ignore this message and consider changing your password after you sign in.
          </p>
        </div>
      </div>
    </div>
  `
}

function renderPasswordResetConfirmationEmail({
  hidCode,
  patientName,
}: {
  hidCode: string
  patientName: string
}) {
  return `
    <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#111827">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
        <div style="padding:24px 28px;background:#0f766e;color:#ffffff">
          <div style="font-size:24px;font-weight:700">Password Updated</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px">Health Identity Directory</div>
        </div>
        <div style="padding:28px">
          <p style="margin:0 0 12px;font-size:14px">Hello ${patientName || 'there'},</p>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.7">
            The password for HID account ${hidCode} was changed successfully.
          </p>
          <p style="margin:0;font-size:14px;line-height:1.7">
            If this was not you, contact support immediately and secure your phone and email accounts.
          </p>
        </div>
      </div>
    </div>
  `
}

function renderPatientRegistrationEmail({
  hidCode,
  patientName,
}: {
  hidCode: string
  patientName: string
}) {
  return `
    <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#111827">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
        <div style="padding:24px 28px;background:#1a6fd4;color:#ffffff">
          <div style="font-size:24px;font-weight:700">Welcome to HID</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px">Health Identity Directory</div>
        </div>
        <div style="padding:28px">
          <p style="margin:0 0 12px;font-size:14px">Hello ${patientName || 'there'},</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.7">
            Your HID account is ready. Keep your Health ID safe and use it whenever you sign in or share access with a hospital.
          </p>
          <div style="margin:0 0 18px;padding:18px;border:1px dashed #93c5fd;border-radius:12px;background:#eff6ff;text-align:center">
            <div style="font-size:12px;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px">Your HID Code</div>
            <div style="font-size:30px;font-weight:700;letter-spacing:0.12em;color:#1a6fd4">${hidCode}</div>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.7">
            You can also sign in with your email address and password, but keep this HID code available for quick access and hospital verification.
          </p>
        </div>
      </div>
    </div>
  `
}

function renderSignupVerificationEmail({
  accountLabel,
  code,
  expiresInMinutes,
}: {
  accountLabel: string
  code: string
  expiresInMinutes: number
}) {
  return `
    <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#111827">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
        <div style="padding:24px 28px;background:#1a6fd4;color:#ffffff">
          <div style="font-size:24px;font-weight:700">Verify your HID account</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px">Health Identity Directory</div>
        </div>
        <div style="padding:28px">
          <p style="margin:0 0 12px;font-size:14px">Hello,</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.7">
            Use the code below to finish creating your ${accountLabel}.
          </p>
          <div style="margin:0 0 18px;padding:18px;border:1px dashed #93c5fd;border-radius:12px;background:#eff6ff;text-align:center">
            <div style="font-size:12px;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px">Verification Code</div>
            <div style="font-size:30px;font-weight:700;letter-spacing:0.24em;color:#1a6fd4">${code}</div>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.7">
            This code expires in ${expiresInMinutes} minutes. If you did not request this, you can ignore this email.
          </p>
        </div>
      </div>
    </div>
  `
}

function renderAccountDeletionEmail({
  accountLabel,
  code,
  expiresInMinutes,
}: {
  accountLabel: string
  code: string
  expiresInMinutes: number
}) {
  return `
    <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#111827">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
        <div style="padding:24px 28px;background:#b91c1c;color:#ffffff">
          <div style="font-size:24px;font-weight:700">Confirm account deletion</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px">Health Identity Directory</div>
        </div>
        <div style="padding:28px">
          <p style="margin:0 0 12px;font-size:14px">Hello,</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.7">
            We received a request to delete your ${accountLabel}. Use the code below to confirm this action.
          </p>
          <div style="margin:0 0 18px;padding:18px;border:1px dashed #fca5a5;border-radius:12px;background:#fef2f2;text-align:center">
            <div style="font-size:12px;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px">Deletion Code</div>
            <div style="font-size:30px;font-weight:700;letter-spacing:0.24em;color:#b91c1c">${code}</div>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.7">
            This code expires in ${expiresInMinutes} minutes. If you did not request account deletion, ignore this email and keep your account signed in.
          </p>
        </div>
      </div>
    </div>
  `
}

function renderPatientRecordAccessAlertEmail({
  accessedAt,
  accessType,
  actorName,
  hidCode,
  hospitalName,
  patientName,
}: {
  accessedAt: string
  accessType: string
  actorName: string
  hidCode: string
  hospitalName: string | null
  patientName: string
}) {
  const providerLabel = hospitalName ? `${actorName} at ${hospitalName}` : actorName
  return `
    <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#111827">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
        <div style="padding:24px 28px;background:#1a6fd4;color:#ffffff">
          <div style="font-size:24px;font-weight:700">Record Access Alert</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px">Health Identity Directory</div>
        </div>
        <div style="padding:28px">
          <p style="margin:0 0 12px;font-size:14px">Hello ${patientName || 'there'},</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.7">
            ${providerLabel} opened your HID medical records for account ${hidCode}.
          </p>
          <div style="margin:0 0 18px;padding:16px;border:1px solid #bfdbfe;border-radius:12px;background:#eff6ff">
            <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Access Details</div>
            <div style="font-size:14px;line-height:1.8">
              <strong>Provider:</strong> ${providerLabel}<br />
              <strong>Access type:</strong> ${accessType}<br />
              <strong>Time:</strong> ${accessedAt}
            </div>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.7">
            If you do not recognize this access, sign in to HID and revoke the active provider access from Access History.
          </p>
        </div>
      </div>
    </div>
  `
}

function renderShareInviteEmail({
  invitedName,
  patientName,
  permissionTierLabel,
  durationLabel,
  reason,
}: {
  invitedName: string | null
  patientName: string
  permissionTierLabel: string
  durationLabel: string
  reason: string | null
}) {
  const greeting = invitedName ? `Hello ${invitedName},` : 'Hello,'
  return `
    <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#111827">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
        <div style="padding:24px 28px;background:#1a6fd4;color:#ffffff">
          <div style="font-size:24px;font-weight:700">You've been invited to HID</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px">Health Identity Directory</div>
        </div>
        <div style="padding:28px">
          <p style="margin:0 0 12px;font-size:14px">${greeting}</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.7">
            ${patientName} wants to share their HID medical profile with you. Once you join HID as a verified provider, you'll automatically get <strong>${permissionTierLabel}</strong> access for <strong>${durationLabel}</strong>.
          </p>
          ${reason ? `
          <div style="margin:0 0 18px;padding:16px;border:1px solid #bfdbfe;border-radius:12px;background:#eff6ff">
            <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Reason</div>
            <div style="font-size:14px;line-height:1.6">${reason}</div>
          </div>
          ` : ''}
          <div style="margin:0 0 18px;text-align:center">
            <a href="https://healthidentitydirectory.com/hospital/auth" style="display:inline-block;padding:12px 28px;border-radius:10px;background:#1a6fd4;color:#ffffff;font-weight:700;text-decoration:none;font-size:14px">
              Join HID
            </a>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.7">
            If you already have a verified HID provider account, simply sign in and access will be granted automatically.
          </p>
        </div>
      </div>
    </div>
  `
}

export async function sendShareInviteEmail(input: ShareInviteDeliveryInput) {
  const errors: string[] = []

  try {
    await sendTransactionalEmail(
      input.email,
      `${input.patientName} invited you to HID`,
      renderShareInviteEmail({
        invitedName: input.invitedName,
        patientName: input.patientName,
        permissionTierLabel: input.permissionTierLabel,
        durationLabel: input.durationLabel,
        reason: input.reason,
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send the invitation email.'
    errors.push(message)
    console.error('share invite email failed', message)
  }

  return errors
}

export async function sendPatientPasswordResetCode(input: PasswordResetDeliveryInput) {
  if (!input.email) {
    throw new HttpError(400, 'This account does not have an email address for password reset.')
  }

  try {
    await sendTransactionalEmail(
      input.email,
      'Your HID password reset code',
      renderPasswordResetEmail({
        code: input.code,
        expiresInMinutes: input.expiresInMinutes,
        hidCode: input.hidCode,
        patientName: input.patientName,
      })
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send the email verification code.'
    console.error('password reset email delivery failed', message)
    throw new HttpError(502, message)
  }

  return {
    receipts: [
      {
        channel: 'email' as const,
        maskedTarget: maskEmailAddress(input.email) ?? input.email,
        provider: 'brevo' as const,
      },
    ],
    errors: [],
  }
}

export async function sendPatientPasswordResetConfirmation(input: PasswordResetConfirmationInput) {
  const errors: string[] = []

  if (input.email) {
    try {
      await sendTransactionalEmail(
        input.email,
        'Your HID password was updated',
        renderPasswordResetConfirmationEmail({
          hidCode: input.hidCode,
          patientName: input.patientName,
        })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send the email confirmation.'
      errors.push(message)
      console.error('password reset confirmation email failed', message)
    }
  }

  return errors
}

export async function sendPatientRegistrationConfirmation(input: PatientRegistrationDeliveryInput) {
  const errors: string[] = []

  if (input.email) {
    try {
      await sendTransactionalEmail(
        input.email,
        'Your HID code is ready',
        renderPatientRegistrationEmail({
          hidCode: input.hidCode,
          patientName: input.patientName,
        }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send the registration email.'
      errors.push(message)
      console.error('patient registration email failed', message)
    }
  }

  return errors
}

export async function sendSignupVerificationCode(input: SignupVerificationDeliveryInput) {
  if (!input.email) {
    throw new HttpError(400, 'This account does not have an email address for verification.')
  }

  try {
    await sendTransactionalEmail(
      input.email,
      'Your HID verification code',
      renderSignupVerificationEmail({
        accountLabel: input.accountLabel,
        code: input.code,
        expiresInMinutes: input.expiresInMinutes,
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send the email verification code.'
    console.error('signup email delivery failed', message)
    throw new HttpError(502, message)
  }

  return {
    receipts: [
      {
        channel: 'email' as const,
        maskedTarget: maskEmailAddress(input.email) ?? input.email,
        provider: 'brevo' as const,
      },
    ],
    errors: [],
  }
}

export async function sendAccountDeletionCode(input: AccountDeletionDeliveryInput) {
  if (!input.email) {
    throw new HttpError(400, 'This account does not have an email address for verification.')
  }

  try {
    await sendTransactionalEmail(
      input.email,
      'Your HID account deletion code',
      renderAccountDeletionEmail({
        accountLabel: input.accountLabel,
        code: input.code,
        expiresInMinutes: input.expiresInMinutes,
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send the email verification code.'
    console.error('account deletion email delivery failed', message)
    throw new HttpError(502, message)
  }

  return {
    receipts: [
      {
        channel: 'email' as const,
        maskedTarget: maskEmailAddress(input.email) ?? input.email,
        provider: 'brevo' as const,
      },
    ],
    errors: [],
  }
}

export async function sendPatientRecordAccessAlert(input: PatientRecordAccessAlertInput) {
  const errors: string[] = []

  if (input.email) {
    try {
      await sendTransactionalEmail(
        input.email,
        'Your HID record was accessed',
        renderPatientRecordAccessAlertEmail(input),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send the record access email.'
      errors.push(message)
      console.error('patient record access email failed', message)
    }
  }

  return errors
}
