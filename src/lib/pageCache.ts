const CACHE_PREFIX = 'hid_page_cache:'
const memoryCache = new Map<string, { expiresAt: number; value: unknown }>()

function buildStorageKey(key: string) {
  return `${CACHE_PREFIX}${key}`
}

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

export function readPageCache<T>(key: string): T | null {
  const now = Date.now()
  const memoryHit = memoryCache.get(key)
  if (memoryHit) {
    if (memoryHit.expiresAt > now) return memoryHit.value as T
    memoryCache.delete(key)
  }

  if (!canUseSessionStorage()) return null

  try {
    const raw = window.sessionStorage.getItem(buildStorageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { expiresAt: number; value: T }
    if (parsed.expiresAt <= now) {
      window.sessionStorage.removeItem(buildStorageKey(key))
      return null
    }
    memoryCache.set(key, parsed)
    return parsed.value
  } catch {
    return null
  }
}

export function writePageCache<T>(key: string, value: T, ttlMs = 45_000) {
  const entry = {
    value,
    expiresAt: Date.now() + ttlMs,
  }

  memoryCache.set(key, entry)
  if (!canUseSessionStorage()) return

  try {
    window.sessionStorage.setItem(buildStorageKey(key), JSON.stringify(entry))
  } catch {
    // Ignore storage quota and serialization errors.
  }
}

export function clearPageCache(key: string) {
  memoryCache.delete(key)
  if (!canUseSessionStorage()) return

  try {
    window.sessionStorage.removeItem(buildStorageKey(key))
  } catch {
    // Ignore storage cleanup failures.
  }
}
