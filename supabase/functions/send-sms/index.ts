import { HttpError, json, withErrorHandling } from '../_shared/http.ts'

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  throw new HttpError(410, 'SMS delivery is no longer enabled for this project. Use the email-based auth flow instead.')
}))
