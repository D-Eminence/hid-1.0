import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asTrimmedString, optionalTrimmedString } from '../_shared/validation.ts'

type Payload = {
  recordId: string
  storagePath: string
  originalFileName: string
  mimeType?: string | null
  sizeBytes?: number | null
  sha256Hex?: string | null
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const body = await readJson<Payload>(req)
  const sizeBytes = body.sizeBytes == null ? null : Number(body.sizeBytes)

  const { data, error } = await client.rpc('hid_register_record_file', {
    p_record_id: asTrimmedString(body.recordId, 'recordId'),
    p_storage_path: asTrimmedString(body.storagePath, 'storagePath'),
    p_original_file_name: asTrimmedString(body.originalFileName, 'originalFileName'),
    p_mime_type: optionalTrimmedString(body.mimeType),
    p_size_bytes: sizeBytes,
    p_sha256_hex: optionalTrimmedString(body.sha256Hex),
  })

  if (error) throw new HttpError(403, error.message, error)
  return json({ data }, 201)
}))
