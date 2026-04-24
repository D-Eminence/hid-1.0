import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { buildCacheHeaders, HttpError, json, withErrorHandling } from '../_shared/http.ts'
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
  patient: unknown
  records: Array<{
    record: unknown
    current_version: unknown
    files: RecordFileEntry[]
  }>
}

type RecordFileStorageRow = {
  id: string
  storage_bucket: string
  storage_path: string
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const url = new URL(req.url)
  const patientIdentifier = url.searchParams.get('patientIdentifier')

  if (patientIdentifier?.trim()) {
    const adminClient = createAdminClient()
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

  if (!payload || fileIds.length === 0) {
    return json({ data }, 200, buildCacheHeaders({
      maxAgeSeconds: 10,
      staleWhileRevalidateSeconds: 45,
    }))
  }

  const { data: fileRows, error: fileRowsError } = await client
    .from('hid_medical_record_files')
    .select('id, storage_bucket, storage_path')
    .in('id', fileIds)

  if (fileRowsError) throw new HttpError(400, 'Unable to prepare record files right now.', fileRowsError)

  const adminClient = createAdminClient()
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

  return json({ data: enrichedPayload }, 200, buildCacheHeaders({
    maxAgeSeconds: 10,
    staleWhileRevalidateSeconds: 45,
  }))
}))
