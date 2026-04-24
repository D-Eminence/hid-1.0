import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { createRecordUploadToken } from '../_shared/upload-token.ts'
import { asTrimmedString, sanitizeFileName } from '../_shared/validation.ts'

type Payload = {
  recordId: string
  fileName: string
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client, profile, user } = await requireUser(req)
  const body = await readJson<Payload>(req)
  const recordId = asTrimmedString(body.recordId, 'recordId')
  const fileName = sanitizeFileName(asTrimmedString(body.fileName, 'fileName'))

  if (!profile?.id) {
    throw new HttpError(403, 'Upload is not authorized.')
  }

  const { data: authorization, error: authError } = await client.rpc('hid_authorize_record_upload', {
    p_record_id: recordId,
  })

  if (authError || !authorization?.patient_id) throw new HttpError(403, authError?.message ?? 'Upload is not authorized.', authError)

  const path = `patients/${authorization.patient_id}/records/${recordId}/${crypto.randomUUID()}-${fileName}`
  const adminClient = createAdminClient()
  const { data, error } = await adminClient.storage.from('medical-record-files').createSignedUploadUrl(path)
  const uploadToken = await createRecordUploadToken({
    authUserId: user.id,
    patientId: authorization.patient_id as string,
    profileId: profile.id,
    recordId,
    storageBucket: 'medical-record-files',
    storagePath: path,
  })

  if (error) throw new HttpError(502, error.message, error)
  return json({ data: { ...data, path, uploadToken: uploadToken.token, uploadTokenExpiresAt: uploadToken.expiresAt } }, 200)
}))
