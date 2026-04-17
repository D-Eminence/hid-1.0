import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { asTrimmedString } from '../_shared/validation.ts'

type Payload = {
  fileId: string
  expiresIn?: number
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const body = await readJson<Payload>(req)
  const fileId = asTrimmedString(body.fileId, 'fileId')

  const { data: fileRow, error: fileError } = await client
    .from('hid_medical_record_files')
    .select('storage_bucket, storage_path')
    .eq('id', fileId)
    .single()

  if (fileError || !fileRow) throw new HttpError(404, 'File was not found.', fileError)

  const adminClient = createAdminClient()
  const expiresIn = Math.max(30, Math.min(Number(body.expiresIn ?? 60), 300))
  const { data, error } = await adminClient
    .storage
    .from(fileRow.storage_bucket)
    .createSignedUrl(fileRow.storage_path, expiresIn)

  if (error) throw new HttpError(502, error.message, error)
  return json({ data }, 200)
}))
