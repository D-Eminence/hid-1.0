const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const NETWORK_TIMEOUT_MS = 15000
export const NETWORK_TIMEOUT_MESSAGE = 'The request took too long. Check your internet connection and try again.'
export const isConfigured = !!(supabaseUrl && supabaseKey)

export function getSupabaseStorageKey() {
  if (!supabaseUrl) return null

  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0]?.trim()
    if (!projectRef) return null
    return `sb-${projectRef}-auth-token`
  } catch {
    return null
  }
}

export function hasStoredSupabaseAuthSession() {
  if (typeof window === 'undefined') return false

  const storageKey = getSupabaseStorageKey()
  if (!storageKey) return false

  const storedValue = window.localStorage.getItem(storageKey)
  if (!storedValue) return false

  const trimmedValue = storedValue.trim()
  return trimmedValue !== '' && trimmedValue !== 'null'
}

export { supabaseKey, supabaseUrl }
