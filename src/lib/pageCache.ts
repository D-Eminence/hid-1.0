import { registerCacheResetter } from './cacheReset'
import { pruneExpiredMapEntries, setBoundedMapEntry } from './cacheBudget'

const CACHE_PREFIX = 'hid_page_cache:'
const memoryCache = new Map<string, { expiresAt: number; value: unknown }>()
const MAX_MEMORY_CACHE_ENTRIES = 48
const MAX_SESSION_STORAGE_ENTRY_BYTES = 220_000

function buildStorageKey(key: string) {
  return `${CACHE_PREFIX}${key}`
}

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

export function readPageCache<T>(key: string): T | null {
  const now = Date.now()
  pruneExpiredMapEntries(memoryCache, now)
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

  setBoundedMapEntry(memoryCache, key, entry, MAX_MEMORY_CACHE_ENTRIES)
  if (!canUseSessionStorage()) return

  try {
    const serialized = JSON.stringify(entry)
    if (serialized.length <= MAX_SESSION_STORAGE_ENTRY_BYTES) {
      window.sessionStorage.setItem(buildStorageKey(key), serialized)
      return
    }

    window.sessionStorage.removeItem(buildStorageKey(key))
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

export function clearAllPageCaches() {
  memoryCache.clear()
  if (!canUseSessionStorage()) return

  try {
    const keysToDelete: string[] = []
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index)
      if (key?.startsWith(CACHE_PREFIX)) {
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach(key => {
      window.sessionStorage.removeItem(key)
    })
  } catch {
    // Ignore storage cleanup failures.
  }
}

registerCacheResetter(clearAllPageCaches)
