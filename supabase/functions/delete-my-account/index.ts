import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, withErrorHandling } from '../_shared/http.ts'

const RECORD_FILE_BUCKET = 'medical-record-files'
const STORAGE_CHUNK_SIZE = 100

async function listStoragePathsForPatient(adminClient: ReturnType<typeof createAdminClient>, patientId: string) {
  const { data, error } = await adminClient
    .from('hid_medical_record_files')
    .select('storage_path')
    .eq('patient_id', patientId)

  if (error) throw new HttpError(400, error.message, error)
  return ((data ?? []) as Array<{ storage_path: string | null }>).map(item => item.storage_path).filter((value): value is string => Boolean(value))
}

async function listStoragePathsForProfile(adminClient: ReturnType<typeof createAdminClient>, profileId: string) {
  const paths = new Set<string>()

  const uploadedFiles = await adminClient
    .from('hid_medical_record_files')
    .select('storage_path')
    .eq('uploaded_by_user_profile_id', profileId)

  if (uploadedFiles.error) throw new HttpError(400, uploadedFiles.error.message, uploadedFiles.error)
  for (const row of ((uploadedFiles.data ?? []) as Array<{ storage_path: string | null }>)) {
    if (row.storage_path) paths.add(row.storage_path)
  }

  const authoredRecords = await adminClient
    .from('hid_medical_records')
    .select('id')
    .eq('created_by_user_profile_id', profileId)

  if (authoredRecords.error) throw new HttpError(400, authoredRecords.error.message, authoredRecords.error)
  const recordIds = ((authoredRecords.data ?? []) as Array<{ id: string }>).map(item => item.id)

  if (recordIds.length > 0) {
    const recordFiles = await adminClient
      .from('hid_medical_record_files')
      .select('storage_path')
      .in('record_id', recordIds)

    if (recordFiles.error) throw new HttpError(400, recordFiles.error.message, recordFiles.error)
    for (const row of ((recordFiles.data ?? []) as Array<{ storage_path: string | null }>)) {
      if (row.storage_path) paths.add(row.storage_path)
    }
  }

  return [...paths]
}

async function removeStoragePaths(adminClient: ReturnType<typeof createAdminClient>, paths: string[]) {
  if (paths.length === 0) return

  for (let index = 0; index < paths.length; index += STORAGE_CHUNK_SIZE) {
    const chunk = paths.slice(index, index + STORAGE_CHUNK_SIZE)
    const { error } = await adminClient.storage.from(RECORD_FILE_BUCKET).remove(chunk)
    if (error) throw new HttpError(400, error.message, error)
  }
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { user } = await requireUser(req)
  const adminClient = createAdminClient()

  const profileResult = await adminClient
    .from('hid_user_profiles')
    .select('id, app_role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (profileResult.error) throw new HttpError(400, profileResult.error.message, profileResult.error)
  if (!profileResult.data) throw new HttpError(404, 'We could not find this account.')
  if (profileResult.data.app_role === 'platform_admin') {
    throw new HttpError(403, 'Platform admin accounts cannot be deleted here.')
  }

  const profileId = profileResult.data.id

  const patientResult = await adminClient
    .from('hid_patients')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (patientResult.error) throw new HttpError(400, patientResult.error.message, patientResult.error)

  const staffResult = await adminClient
    .from('hid_staff_accounts')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (staffResult.error) throw new HttpError(400, staffResult.error.message, staffResult.error)

  const storagePaths = new Set<string>()

  if (patientResult.data?.id) {
    for (const path of await listStoragePathsForPatient(adminClient, patientResult.data.id)) {
      storagePaths.add(path)
    }
  }

  for (const path of await listStoragePathsForProfile(adminClient, profileId)) {
    storagePaths.add(path)
  }

  await removeStoragePaths(adminClient, [...storagePaths])

  const { data, error } = await adminClient.rpc('hid_delete_account_by_auth_user_id', {
    p_auth_user_id: user.id,
  })

  if (error) throw new HttpError(400, error.message, error)
  return json({ data: data ?? { deleted: true } })
}))
