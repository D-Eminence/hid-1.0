type GoogleCredentialResponse = { credential?: string }

type GooglePromptNotification = {
  isNotDisplayed?: () => boolean
  isSkippedMoment?: () => boolean
  getNotDisplayedReason?: () => string
}

type GoogleIdentityApi = {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void
      prompt: (listener?: (notification: GooglePromptNotification) => void) => void
      cancel: () => void
    }
  }
}

declare global {
  interface Window { google?: GoogleIdentityApi }
}

let googleScriptPromise: Promise<void> | null = null

function loadGoogleIdentityScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google sign-up is only available in a browser.'))
  if (window.google?.accounts?.id) return Promise.resolve()
  if (googleScriptPromise) return googleScriptPromise

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-hid-google-identity]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Unable to load Google sign-up right now.')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.hidGoogleIdentity = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Unable to load Google sign-up right now.'))
    document.head.appendChild(script)
  }).catch(error => {
    googleScriptPromise = null
    throw error
  })
  return googleScriptPromise
}

function decodeGoogleCredential(credential: string) {
  const payload = credential.split('.')[1]
  if (!payload) throw new Error('Google did not return a valid identity.')
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = decodeURIComponent(window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
    .split('').map(character => `%${`00${character.charCodeAt(0).toString(16)}`.slice(-2)}`).join(''))
  const data = JSON.parse(decoded) as { email?: string; given_name?: string; family_name?: string; name?: string }
  if (!data.email) throw new Error('Google did not provide an email address.')
  const names = (data.name ?? '').trim().split(/\s+/).filter(Boolean)
  return {
    email: data.email.trim().toLowerCase(),
    firstName: (data.given_name ?? names[0] ?? '').trim(),
    lastName: (data.family_name ?? names.slice(1).join(' ')).trim(),
  }
}

export async function prefillWithGoogleIdentity() {
  const clientId = `${import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''}`.trim()
  if (!clientId) throw new Error('Google prefill is not configured yet. Add the Google Web Client ID to the production app settings.')
  await loadGoogleIdentityScript()
  if (!window.google?.accounts?.id) throw new Error('Google sign-up is unavailable right now.')
  const googleIdentity = window.google

  return new Promise<ReturnType<typeof decodeGoogleCredential>>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
      googleIdentity.accounts.id.cancel()
    }
    googleIdentity.accounts.id.initialize({
      client_id: clientId,
      callback: response => {
        if (!response.credential) {
          finish(() => reject(new Error('Google did not return an identity.')))
          return
        }
        try {
          finish(() => resolve(decodeGoogleCredential(response.credential as string)))
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error('Unable to read the Google identity.')))
        }
      },
    })
    googleIdentity.accounts.id.prompt(notification => {
      if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
        const reason = notification.getNotDisplayedReason?.()
        finish(() => reject(new Error(reason ? `Google sign-up could not open (${reason}).` : 'Google sign-up was cancelled.')))
      }
    })
  })
}
