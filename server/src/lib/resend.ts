import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY ?? 'placeholder')
const FROM   = process.env.RESEND_FROM ?? 'HID Health <noreply@hidhealth.com>'

export async function sendHIDEmail(opts: {
  to: string; name: string; hidCode: string
}): Promise<{ success: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY not set — email not sent')
    return { success: false, error: 'Email service not configured' }
  }
  try {
    await resend.emails.send({
      from: FROM, to: opts.to,
      subject: 'Your Health Identity (HID) Code',
      html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f3f4f6;margin:0;padding:40px 20px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <div style="background:#1a6fd4;padding:28px 32px;display:flex;align-items:center;gap:14px">
    <div>
      <div style="color:white;font-size:22px;font-weight:900;letter-spacing:-.5px">HID</div>
      <div style="color:rgba(255,255,255,.7);font-size:9px;letter-spacing:1.2px;font-weight:700;text-transform:uppercase">Health Identity Directory</div>
    </div>
  </div>
  <div style="padding:32px">
    <p style="color:#374151;font-size:15px;margin:0 0 8px">Hello <strong>${opts.name}</strong>,</p>
    <p style="color:#6b7280;font-size:14px;line-height:1.7;margin:0 0 24px">
      Your Health Identity account has been created successfully. 
      Below is your unique HID code — keep it safe and present it at any hospital to access your medical records.
    </p>
    <div style="background:#eff6ff;border:2px dashed #93c5fd;border-radius:14px;padding:28px;text-align:center;margin-bottom:24px">
      <div style="font-size:11px;color:#9ca3af;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:10px">Your Health Identity Code</div>
      <div style="font-size:28px;font-weight:900;letter-spacing:5px;color:#1a6fd4;font-family:monospace">${opts.hidCode}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:10px">Valid at all HID-connected healthcare facilities</div>
    </div>
    <div style="background:#f8fafc;border-radius:10px;padding:16px;font-size:13px;color:#6b7280;line-height:1.7;border:1px solid #e2e8f0">
      <strong style="color:#374151">⚠️ Important:</strong> This code is your permanent health identifier. 
      Never share it with unauthorised persons. Present it at hospitals, clinics, or pharmacies for instant record access.
    </div>
  </div>
  <div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center">
    <p style="font-size:12px;color:#9ca3af;margin:0">© ${new Date().getFullYear()} HID Technologies · Health Identity Directory</p>
  </div>
</div>
</body></html>`
    })
    return { success: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Resend error:', msg)
    return { success: false, error: msg }
  }
}
