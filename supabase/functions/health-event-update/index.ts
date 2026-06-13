import { createAdminClient, requireUser } from '../_shared/auth.ts'
import { HttpError, json, readJson, withErrorHandling } from '../_shared/http.ts'
import { assertStaffRoleCapability } from '../_shared/platform.ts'
import { asTrimmedString, optionalTrimmedString } from '../_shared/validation.ts'

const HEALTH_EVENT_STATUSES = ['active', 'monitoring', 'resolved', 'archived'] as const

type Payload = {
  healthEventId: string
  action: 'add_record' | 'remove_record' | 'rename' | 'set_status'
  recordId?: string
  title?: string
  status?: string
}

Deno.serve(req => withErrorHandling(req, async () => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')

  const { client, staffAccount } = await requireUser(req)
  const body = await readJson<Payload>(req)
  const healthEventId = asTrimmedString(body.healthEventId, 'healthEventId')

  if (staffAccount?.role) {
    await assertStaffRoleCapability(createAdminClient(), staffAccount.role, 'can_create_records')
  }

  switch (body.action) {
    case 'add_record': {
      const recordId = asTrimmedString(body.recordId, 'recordId')
      const { data, error } = await client.rpc('hid_add_record_to_health_event', {
        p_health_event_id: healthEventId,
        p_record_id: recordId,
      })
      if (error) throw new HttpError(403, error.message, error)
      return json({ data })
    }

    case 'remove_record': {
      const recordId = asTrimmedString(body.recordId, 'recordId')
      const { data, error } = await client.rpc('hid_remove_record_from_health_event', {
        p_health_event_id: healthEventId,
        p_record_id: recordId,
      })
      if (error) throw new HttpError(403, error.message, error)
      return json({ data })
    }

    case 'rename': {
      const title = asTrimmedString(body.title, 'title')
      const { data, error } = await client.rpc('hid_update_health_event', {
        p_health_event_id: healthEventId,
        p_title: title,
        p_status: null,
      })
      if (error) throw new HttpError(403, error.message, error)
      return json({ data })
    }

    case 'set_status': {
      const status = asTrimmedString(body.status, 'status')
      if (!HEALTH_EVENT_STATUSES.includes(status as typeof HEALTH_EVENT_STATUSES[number])) {
        throw new HttpError(400, 'Invalid status.')
      }
      const { data, error } = await client.rpc('hid_update_health_event', {
        p_health_event_id: healthEventId,
        p_title: optionalTrimmedString(body.title),
        p_status: status,
      })
      if (error) throw new HttpError(403, error.message, error)
      return json({ data })
    }

    default:
      throw new HttpError(400, 'Unsupported action.')
  }
}))
