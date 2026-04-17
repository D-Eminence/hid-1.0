import { requireUser } from '../_shared/auth.ts'
import { HttpError, json, withErrorHandling } from '../_shared/http.ts'

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')

  const { client } = await requireUser(req)
  const { data, error } = await client.rpc('hid_get_my_patient_profile')

  if (error) throw new HttpError(400, error.message, error)
  if (!data) throw new HttpError(404, 'Patient profile not found.')

  return json({ data })
}))
