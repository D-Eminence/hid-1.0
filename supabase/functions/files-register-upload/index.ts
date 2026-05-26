import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { assertPlatformFeatureEnabled, assertStaffRoleCapability } from '../_shared/platform.ts'
import { verifyRecordUploadToken } from '../_shared/upload-token.ts'
import { asTrimmedString, optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  recordId: string
  originalFileName: string
  uploadToken: string
  mimeType?: string | null
  sizeBytes?: number | null
  sha256Hex?: string | null
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client, profile, staffAccount, user } = await requireUser(req)
  const body = await readJson<Payload>(req)
  const sizeBytes = body.sizeBytes == null ? null : Number(body.sizeBytes)
  const recordId = asTrimmedString(body.recordId, 'recordId')
  const tokenPayload = await verifyRecordUploadToken(asTrimmedString(body.uploadToken, 'uploadToken'))

  if (!profile?.id || tokenPayload.authUserId !== user.id || tokenPayload.profileId !== profile.id || tokenPayload.recordId !== recordId) {
    throw new HttpError(403, 'Upload is not authorized.')
  }

  const adminClient = createAdminClient()
  await assertPlatformFeatureEnabled(adminClient, 'uploads')
  if (staffAccount?.role) {
    await assertStaffRoleCapability(adminClient, staffAccount.role, 'can_create_records')
  }

  const { data, error } = await client.rpc('hid_register_record_file', {
    p_record_id: recordId,
    p_storage_path: tokenPayload.storagePath,
    p_original_file_name: asTrimmedString(body.originalFileName, 'originalFileName'),
    p_mime_type: optionalTrimmedString(body.mimeType),
    p_size_bytes: sizeBytes,
    p_sha256_hex: optionalTrimmedString(body.sha256Hex),
  })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data }, 201)
}))
