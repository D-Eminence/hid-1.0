import { useCallback, useEffect, useState } from 'react'
import { sanitizeUserFacingMessage, showToast } from '../components/ui'
import { fetchAdminDashboardOverview } from '../services/adminDashboard'
import type { AdminDashboardOverview, AdminOverviewWindow } from '../types/admin'

const REFRESH_INTERVAL_MS = 60000

export function useAdminDashboard(windowKey: AdminOverviewWindow) {
  const [data, setData] = useState<AdminDashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)

    try {
      const next = await fetchAdminDashboardOverview(windowKey)
      setData(next)
      setError(null)
      return next
    } catch (reason) {
      const rawMessage = reason instanceof Error ? reason.message : 'Unable to load the admin dashboard.'
      const lower = rawMessage.toLowerCase()
      const message =
        lower.includes('permission')
          ? 'Admin access is limited to platform admins.'
          : lower.includes('sign in') || lower.includes('401')
            ? 'Sign in to open the admin dashboard.'
            : lower.includes('sentry')
              ? 'Sentry data is not available right now.'
              : lower.includes('posthog')
                ? 'PostHog data is not available right now.'
                : sanitizeUserFacingMessage(rawMessage, 'error')
      setError(message)
      if (!silent) {
        showToast(message, 'error')
      }
      throw reason
    } finally {
      if (!silent) setLoading(false)
    }
  }, [windowKey])

  useEffect(() => {
    void refresh().catch(() => undefined)
  }, [refresh])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh(true).catch(() => undefined)
    }, REFRESH_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [refresh])

  return {
    data,
    error,
    loading,
    refresh,
  }
}
