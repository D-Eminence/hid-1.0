import { supabase } from './supabase'
import { formatDateTime } from './utils'

export async function logPatientActivity(hidCode: string, title: string, detail: string) {
  const timestamp = new Date().toISOString()
  await supabase.from('notifications').insert({
    hid_code: hidCode,
    title,
    message: `${detail} at ${formatDateTime(timestamp)}.`,
    type: 'system',
  } as any)
}
