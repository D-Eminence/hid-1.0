export async function registerAppServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  if (import.meta.env.DEV) return

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
      updateViaCache: 'none',
    })
    void registration.update()
  } catch {
    // Service worker registration is best effort only.
  }
}
