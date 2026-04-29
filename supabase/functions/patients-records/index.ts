import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, withErrorHandling } from '../_shared/http.ts'
import { sendPatientRecordAccessAlert } from '../_shared/notifications.ts'
import { resolvePatientAccessState } from '../_shared/patient-identifiers.ts'

type RecordFileEntry = {
  id: string
  created_at: string
  mime_type: string | null
  original_file_name: string
  patient_id: string
  record_id: string
  record_version_id: string
  size_bytes: number | null
  uploaded_by_user_profile_id: string
}

type PatientRecordsResponse = {
  patient: PatientRecordAccessRow
  records: Array<{
    record: unknown
    current_version: unknown
    files: RecordFileEntry[]
  }>
}

type PatientRecordAccessRow = {
  email: string | null
  full_name: string | null
  hid_code: string
  id: string
  user_profile_id: string
}

type RecordFileStorageRow = {
  id: string
  storage_bucket: string
  storage_path: string
}

type StaffAccountRow = {
  full_name: string | null
  hospital_name: string | null
}

type ActiveGrantRow = {
  scope: string | null
  staff_display_name: string | null
}

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
}

async function notifyPatientRecordAccess({
  adminClient,
  client,
  patient,
  profileDisplayName,
  staffAccountId,
}: {
  adminClient: ReturnType<typeof createAdminClient>
  client: Awaited<ReturnType<typeof requireUser>>['client']
  patient: PatientRecordAccessRow
  profileDisplayName: string | null
  staffAccountId: string
}) {
  const [staffResult, grantResult] = await Promise.all([
    adminClient
      .from('hid_staff_accounts')
      .select('full_name, hospital_name')
      .eq('id', staffAccountId)
      .maybeSingle(),
    adminClient
      .from('hid_access_grants')
      .select('scope, staff_display_name')
      .eq('patient_id', patient.id)
      .eq('staff_account_id', staffAccountId)
      .eq('status', 'active')
      .lte('starts_at', new Date().toISOString())
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (staffResult.error) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: staffResult.error.message,
      path: '/functions/v1/patients-records',
    }))
  }
  if (grantResult.error) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: grantResult.error.message,
      path: '/functions/v1/patients-records',
    }))
  }

  const staff = (staffResult.data ?? null) as StaffAccountRow | null
  const grant = (grantResult.data ?? null) as ActiveGrantRow | null
  const actorName = grant?.staff_display_name?.trim() || staff?.full_name?.trim() || profileDisplayName?.trim() || 'A hospital provider'
  const hospitalName = staff?.hospital_name?.trim() || null
  const accessType = grant?.scope === 'break_glass' ? 'Emergency access' : 'Provider access'
  const notificationMessage = hospitalName
    ? `${actorName} at ${hospitalName} opened your HID medical records.`
    : `${actorName} opened your HID medical records.`

  const notificationResult = await adminClient
    .from('hid_notifications')
    .insert({
      user_profile_id: patient.user_profile_id,
      patient_id: patient.id,
      title: 'Your HID record was accessed',
      message: notificationMessage,
      type: 'record_access',
    })

  if (notificationResult.error) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: notificationResult.error.message,
      path: '/functions/v1/patients-records',
    }))
  }

  const auditResult = await client.rpc('hid_log_audit_event', {
    p_resource_type: 'medical_record',
    p_action: 'record_accessed',
    p_resource_id: null,
    p_patient_id: patient.id,
    p_organization_id: null,
    p_reason: 'Patient records opened',
    p_metadata: {
      access_type: accessType,
      hospital_name: hospitalName,
      staff_display_name: actorName,
    },
  })

  if (auditResult.error) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: auditResult.error.message,
      path: '/functions/v1/patients-records',
    }))
  }

  await sendPatientRecordAccessAlert({
    accessedAt: new Date().toISOString(),
    accessType,
    actorName,
    email: patient.email,
    hidCode: patient.hid_code,
    hospitalName,
    patientName: patient.full_name ?? 'there',
  })
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')

  const { client, profile, staffAccount } = await requireUser(req)
  const url = new URL(req.url)
  const patientIdentifier = url.searchParams.get('patientIdentifier')
  const adminClient = createAdminClient()

  if (patientIdentifier?.trim()) {
    const patientState = await resolvePatientAccessState(adminClient, patientIdentifier)

    if (patientState?.profileDeleted || patientState?.patientDeleted) {
      throw new HttpError(403, 'This patient account has been deleted and cannot be opened by a hospital.')
    }
    if (patientState?.profileActive === false) {
      throw new HttpError(403, 'This patient account is locked right now.')
    }
  }

  const { data, error } = await client.rpc('hid_get_patient_records', {
    p_patient_identifier: patientIdentifier,
  })

  if (error) throw new HttpError(403, error.message, error)

  const payload = (data ?? null) as PatientRecordsResponse | null
  const fileIds = (payload?.records ?? []).flatMap(record => (record.files ?? []).map(file => file.id))
  const shouldNotifyPatient = Boolean(patientIdentifier?.trim() && staffAccount?.id && payload?.patient?.id)

  if (shouldNotifyPatient && payload?.patient && staffAccount?.id) {
    await notifyPatientRecordAccess({
      adminClient,
      client,
      patient: payload.patient,
      profileDisplayName: profile?.display_name ?? null,
      staffAccountId: staffAccount.id,
    })
  }

  if (!payload || fileIds.length === 0) {
    return json({ data }, 200, NO_STORE_HEADERS)
  }

  const { data: fileRows, error: fileRowsError } = await client
    .from('hid_medical_record_files')
    .select('id, storage_bucket, storage_path')
    .in('id', fileIds)

  if (fileRowsError) throw new HttpError(400, 'Unable to prepare record files right now.', fileRowsError)

  const signedUrlEntries = await Promise.all(((fileRows ?? []) as RecordFileStorageRow[]).map(async fileRow => {
    const { data: signedData, error: signedError } = await adminClient
      .storage
      .from(fileRow.storage_bucket)
      .createSignedUrl(fileRow.storage_path, 180)

    if (signedError) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: signedError.message,
        fileId: fileRow.id,
        path: '/functions/v1/patients-records',
      }))
      return [fileRow.id, null] as const
    }

    return [fileRow.id, signedData.signedUrl] as const
  }))

  const signedUrlMap = new Map(signedUrlEntries)
  const enrichedPayload = {
    ...payload,
    records: payload.records.map(record => ({
      ...record,
      files: (record.files ?? []).map(file => ({
        ...file,
        signed_download_url: signedUrlMap.get(file.id) ?? null,
      })),
    })),
  }

  return json({ data: enrichedPayload }, 200, NO_STORE_HEADERS)
}))
