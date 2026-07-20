import { optionalEnv } from './env.ts'
import { HttpError } from './http.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

async function encryptionKey() {
  const secret = optionalEnv('HID_AI_CONFIG_KEK')
  if (!secret || secret.length < 32) {
    throw new HttpError(503, 'Provider credential storage is not configured. Set HID_AI_CONFIG_KEK on the server.')
  }
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptProviderApiKey(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), encoder.encode(value))
  return {
    api_key_ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    api_key_iv: bytesToBase64(iv),
    api_key_masked: value.length <= 8 ? '••••••••' : `${value.slice(0, Math.min(7, value.length - 4))}••••••••${value.slice(-2)}`,
  }
}

export async function decryptProviderApiKey(provider: {
  api_key_ciphertext?: unknown
  api_key_iv?: unknown
}) {
  const ciphertext = `${provider.api_key_ciphertext ?? ''}`.trim()
  const ivValue = `${provider.api_key_iv ?? ''}`.trim()
  if (!ciphertext || !ivValue) throw new HttpError(409, 'This provider does not have a stored API key.')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivValue) },
    await encryptionKey(),
    base64ToBytes(ciphertext),
  )
  return decoder.decode(plaintext)
}
