import { supabase } from '../../../lib/supabase'
import type { MigrationAccessContext } from '../domain'

function getErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return 'HID Migrate could not verify your access right now.'
  }

  const raw = String((error as { message: unknown }).message ?? '')
  try {
    const parsed = JSON.parse(raw) as { error?: string; message?: string }
    return parsed.error ?? parsed.message ?? raw
  } catch {
    return raw || 'HID Migrate could not verify your access right now.'
  }
}

export async function fetchMigrationContext(): Promise<MigrationAccessContext> {
  const result = await supabase.functions.invoke('migration-context', { method: 'GET' })
  if (result.error) throw new Error(getErrorMessage(result.error))

  const envelope = result.data as { data?: MigrationAccessContext } | MigrationAccessContext | null
  const context = envelope && 'projects' in envelope
    ? envelope
    : envelope?.data
  if (!context || !Array.isArray(context.projects)) {
    throw new Error('HID Migrate returned an invalid access response.')
  }
  return context
}
