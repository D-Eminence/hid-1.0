export async function registerAppServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  if (import.meta.env.DEV) return

  try {
    const existingRegistration = await navigator.serviceWorker.getRegistration('/')
    const registration = existingRegistration ?? await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
      updateViaCache: 'none',
    })

    await registration.update().catch(() => undefined)
  } catch {
    // Service worker registration is best effort only.
  }
}
