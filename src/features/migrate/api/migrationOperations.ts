import { supabase } from '../../../lib/supabase'

type PageEnvelope<T> = { data: T[]; page: { next_cursor: string | null } }

function message(error: unknown) {
  const raw = error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message ?? '')
    : ''
  try {
    const parsed = JSON.parse(raw) as { error?: string }
    return parsed.error ?? raw
  } catch {
    return raw || 'The migration operation could not be completed.'
  }
}

export async function listMigrationResource<T>(
  resource: 'projects' | 'members' | 'batches' | 'assignments' | 'eligible_staff' | 'operations' | 'audit',
  projectId?: string,
  cursor?: string | null,
): Promise<PageEnvelope<T>> {
  const params = new URLSearchParams({ resource, limit: '25' })
  if (projectId) params.set('project_id', projectId)
  if (cursor) params.set('cursor', cursor)
  const result = await supabase.functions.invoke(`migration-operations?${params}`, { method: 'GET' })
  if (result.error) throw new Error(message(result.error))
  return result.data as PageEnvelope<T>
}

export async function runMigrationOperation<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const result = await supabase.functions.invoke('migration-operations', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: { action, ...payload },
  })
  if (result.error) throw new Error(message(result.error))
  const envelope = result.data as { data: T }
  return envelope.data
}
