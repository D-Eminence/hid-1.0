import { createClient } from '@supabase/supabase-js'

const url  = process.env.SUPABASE_URL  ?? 'https://placeholder.supabase.co'
const key  = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? 'placeholder'

export const isConfigured = !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY))
export const supabase = createClient(url, key)
