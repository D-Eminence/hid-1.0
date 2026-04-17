import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const NETWORK_TIMEOUT_MS = 15000
export const NETWORK_TIMEOUT_MESSAGE = 'The request took too long. Check your internet connection and try again.'

export const isConfigured = !!(supabaseUrl && supabaseKey)

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort(new Error(NETWORK_TIMEOUT_MESSAGE))
  }, NETWORK_TIMEOUT_MS)
  const cleanupCallbacks: Array<() => void> = []
  const signals = [init.signal, isRequest(input) ? input.signal : null].filter(
    (value): value is AbortSignal => Boolean(value)
  )

  signals.forEach(signal => {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return
    }

    const handleAbort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', handleAbort, { once: true })
    cleanupCallbacks.push(() => signal.removeEventListener('abort', handleAbort))
  })

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted && !signals.some(signal => signal.aborted)) {
      throw new Error(NETWORK_TIMEOUT_MESSAGE)
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeoutId)
    cleanupCallbacks.forEach(cleanup => cleanup())
  }
}

// Use placeholder values so createClient never throws on load
export const supabase = createClient<Database>(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseKey ?? 'placeholder-key',
  {
    global: {
      fetch: fetchWithTimeout,
    },
  }
)
