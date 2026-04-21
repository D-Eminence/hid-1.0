import React, { useEffect, useMemo, useState } from 'react'
import { AdminLayout, type AdminSidebarSection } from '../../components/AdminLayout'
import { AdminFunnelChart } from '../../components/admin/AdminFunnelChart'
import { AdminMetricCard } from '../../components/admin/AdminMetricCard'
import { AdminSeriesChart } from '../../components/admin/AdminSeriesChart'
import { Badge, Button, EmptyState, PageLoader, showToast } from '../../components/ui'
import { useAdminDashboard } from '../../hooks/useAdminDashboard'
import { ADMIN_LOGIN_PATH, ADMIN_OVERVIEW_PATH } from '../../lib/adminRoutes'
import { signOutAndClearSessions } from '../../lib/auth'
import { getSafeUser } from '../../lib/supabase'
import { applyAdminUserAction, searchAdminUsers } from '../../services/adminDashboard'
import type { AdminAlert, AdminManagedUser, AdminOverviewWindow, AdminUserManagementAction } from '../../types/admin'

const windowOptions: Array<{ key: AdminOverviewWindow; label: string }> = [
  { key: '24h', label: 'Today' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
]

const sidebarSections: AdminSidebarSection[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'users', label: 'Users' },
  { id: 'records', label: 'Records' },
  { id: 'providers', label: 'Providers' },
  { id: 'security', label: 'Security' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'settings', label: 'Settings' },
]

function formatCompact(value: number | null) {
  if (value == null) return 'N/A'
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatStorage(bytes: number | null) {
  if (bytes == null) return 'N/A'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatPercentage(value: number | null) {
  if (value == null) return 'N/A'
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

function formatDuration(value: number | null) {
  if (value == null) return 'N/A'
  return `${value.toFixed(0)}ms`
}

function formatDateTime(value: string | null) {
  if (!value) return 'N/A'
  return new Date(value).toLocaleString()
}

function formatRelativeTime(value: string | null) {
  if (!value) return 'N/A'
  const diffMs = Date.now() - new Date(value).getTime()
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000))
  if (diffMinutes < 60) return `${diffMinutes} min ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} hr ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
}

function formatLabelValue(value: string | number | null | undefined) {
  if (value == null || value === '') return 'Not available'
  return String(value)
}

function formatBool(value: boolean) {
  return value ? 'Yes' : 'No'
}

function matchesQuery(values: Array<string | null | undefined>, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return values.some(value => `${value ?? ''}`.toLowerCase().includes(normalized))
}

const POSTHOG_WEB_SIGNAL_EVENT_KEYS = new Set([
  '$autocapture',
  '$identify',
  '$pageview',
  '$web_vitals',
  'web_vitals',
  'web vitals',
])

function normalizePosthogEventKey(value: string | null | undefined) {
  return `${value ?? ''}`.trim().toLowerCase().replace(/\s+/g, '_')
}

function metricIcon(path: 'users' | 'plus' | 'activity' | 'check' | 'records' | 'upload' | 'average' | 'storage' | 'providers' | 'provider-active' | 'api' | 'warning' | 'uptime' | 'failed' | 'lock' | 'shield' | 'analytics', color = 'var(--admin-accent)') {
  const wrap: React.CSSProperties = {
    width: 20,
    height: 20,
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(26, 111, 212, 0.08)',
    color,
  }

  const strokeProps = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  const icon = (() => {
    switch (path) {
      case 'users':
        return <path d="M3.6 12.4c.5-1.8 1.9-2.8 3.4-2.8 1.5 0 2.9 1 3.4 2.8M7 7.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" {...strokeProps} />
      case 'plus':
        return <path d="M8 3.2v9.6M3.2 8h9.6" {...strokeProps} />
      case 'activity':
        return <path d="M2.8 8h2.1l1.3-2.8 1.8 5 1.5-3h2.7" {...strokeProps} />
      case 'check':
        return <path d="m3.4 8 2.3 2.3L12.6 3.8" {...strokeProps} />
      case 'records':
        return <><rect x="3.2" y="2.8" width="9.6" height="10.4" rx="1.4" {...strokeProps} /><path d="M5.4 5.4h5.2M5.4 7.8h5.2M5.4 10.2h3.2" {...strokeProps} /></>
      case 'upload':
        return <><path d="M8 11V4.2M5.2 7 8 4.2 10.8 7" {...strokeProps} /><path d="M3.2 11.8h9.6" {...strokeProps} /></>
      case 'average':
        return <path d="M3.2 10.8 6 6l2 3 2.8-4 2 5.8" {...strokeProps} />
      case 'storage':
        return <><ellipse cx="8" cy="4.2" rx="4.2" ry="1.8" {...strokeProps} /><path d="M3.8 4.2v4.8c0 1 1.9 1.8 4.2 1.8s4.2-.8 4.2-1.8V4.2" {...strokeProps} /></>
      case 'providers':
        return <path d="M3 12.8V6.2L8 3l5 3.2v6.6M6.2 12.8V9.1h3.6v3.7" {...strokeProps} />
      case 'provider-active':
        return <><circle cx="6.2" cy="6" r="2" {...strokeProps} /><path d="M3.6 12.5c.4-1.6 1.5-2.6 2.6-2.6s2.2 1 2.6 2.6" {...strokeProps} /><path d="M11 5.2h2.8M12.4 3.8v2.8" {...strokeProps} /></>
      case 'api':
        return <path d="M4 10.8 6.5 5.2 9.2 10l2-3.2" {...strokeProps} />
      case 'warning':
        return <><path d="M8 3.1 13 12H3L8 3.1Z" {...strokeProps} /><path d="M8 6.4v2.5" {...strokeProps} /><circle cx="8" cy="10.2" r=".5" fill="currentColor" /></>
      case 'uptime':
        return <><circle cx="8" cy="8" r="5" {...strokeProps} /><path d="M8 5v3l2 1.4" {...strokeProps} /></>
      case 'failed':
        return <><path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" {...strokeProps} /></>
      case 'lock':
        return <><rect x="4.4" y="7.4" width="7.2" height="5.2" rx="1.2" {...strokeProps} /><path d="M5.8 7.4V5.8a2.2 2.2 0 1 1 4.4 0v1.6" {...strokeProps} /></>
      case 'shield':
        return <path d="M8 3.2 12 4.6v2.7c0 2.2-1.4 3.8-4 5.4-2.6-1.6-4-3.2-4-5.4V4.6L8 3.2Z" {...strokeProps} />
      case 'analytics':
      default:
        return <path d="M3.4 11.8h9.2M5 10V7.2M8 10V4.6M11 10V6.2" {...strokeProps} />
    }
  })()

  return (
    <span style={wrap}>
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
        {icon}
      </svg>
    </span>
  )
}

function sectionLabel(label: string) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: '#93a1b4', textTransform: 'uppercase', marginBottom: 8 }}>
      {label}
    </div>
  )
}

function sectionTitle(title: string) {
  return (
    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1f2937', marginBottom: 12 }}>
      {title}
    </div>
  )
}

function panelStyle(): React.CSSProperties {
  return {
    background: '#fff',
    border: '1px solid var(--admin-border)',
    borderRadius: 12,
    padding: 14,
    boxShadow: 'var(--admin-shadow)',
  }
}

function tableHeaderCell(label: string) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#98a6b7' }}>
      {label}
    </div>
  )
}

function alertToneStyle(level: AdminAlert['level']): React.CSSProperties {
  if (level === 'critical') {
    return {
      background: 'rgba(239, 68, 68, 0.08)',
      border: '1px solid rgba(239, 68, 68, 0.16)',
      color: '#b91c1c',
    }
  }
  if (level === 'warning') {
    return {
      background: 'rgba(245, 158, 11, 0.10)',
      border: '1px solid rgba(245, 158, 11, 0.18)',
      color: '#b45309',
    }
  }
  return {
    background: 'rgba(59, 130, 246, 0.08)',
    border: '1px solid rgba(59, 130, 246, 0.14)',
    color: '#1d4ed8',
  }
}

function statusBadgeColor(status: string) {
  if (status === 'verified') return 'green'
  if (status === 'unverified') return 'amber'
  return 'gray'
}

function readinessTone(ready: boolean) {
  return ready ? 'green' : 'amber'
}

export default function AdminDashboard() {
  const [viewerEmail, setViewerEmail] = useState<string | null>(null)
  const [windowKey, setWindowKey] = useState<AdminOverviewWindow>('7d')
  const [searchQuery, setSearchQuery] = useState('')
  const [directoryQuery, setDirectoryQuery] = useState('')
  const [directoryResults, setDirectoryResults] = useState<AdminManagedUser[]>([])
  const [selectedDirectoryUserId, setSelectedDirectoryUserId] = useState<string | null>(null)
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [actioning, setActioning] = useState<AdminUserManagementAction | null>(null)
  const [activeSection, setActiveSection] = useState('dashboard')
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440))
  const { data, error, loading, refreshing, refresh } = useAdminDashboard(windowKey)

  useEffect(() => {
    void loadViewer()
  }, [])

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      const visible = [...sidebarSections].reverse().find(section => {
        const element = document.getElementById(section.id)
        if (!element) return false
        return element.getBoundingClientRect().top <= 180
      })
      if (visible) setActiveSection(visible.id)
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  async function loadViewer() {
    const user = await getSafeUser()
    setViewerEmail(user?.email ?? null)
  }

  async function logout() {
    await signOutAndClearSessions()
    window.location.assign(ADMIN_OVERVIEW_PATH)
  }

  const selectedDirectoryUser = useMemo(() => (
    directoryResults.find(item => item.id === selectedDirectoryUserId) ?? null
  ), [directoryResults, selectedDirectoryUserId])

  async function runDirectorySearch(force = false) {
    const trimmed = directoryQuery.trim()
    if (!trimmed) {
      setDirectoryResults([])
      setSelectedDirectoryUserId(null)
      setDirectoryError('Enter an HID code or email to search.')
      return
    }

    setDirectoryLoading(true)
    setDirectoryError(null)
    try {
      const matches = await searchAdminUsers(trimmed, { force })
      setDirectoryResults(matches)
      setSelectedDirectoryUserId(current => {
        if (matches.length === 0) return null
        if (current && matches.some(item => item.id === current)) return current
        return matches[0].id
      })
      if (matches.length === 0) {
        setDirectoryError('No user matched that HID code or email.')
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The user directory could not be loaded right now.'
      setDirectoryError(message)
      showToast(message, 'error')
    } finally {
      setDirectoryLoading(false)
    }
  }

  async function handleDirectoryAction(action: AdminUserManagementAction) {
    if (!selectedDirectoryUser) return

    const actionLabels: Record<AdminUserManagementAction, string> = {
      close_patient_access: 'close this patient access',
      delete_account: 'delete this account permanently',
      lock_profile: 'lock this profile',
      restore_staff_access: 'restore this hospital access',
      restrict_staff_access: 'restrict this hospital access',
      unlock_profile: 'unlock this profile',
    }

    const confirmed = window.confirm(`Do you want to ${actionLabels[action]}?`)
    if (!confirmed) return

    setActioning(action)
    try {
      const result = await applyAdminUserAction(selectedDirectoryUser.id, action)
      if (result.deleted) {
        setDirectoryResults(current => current.filter(item => item.id !== result.targetAuthUserId))
        setSelectedDirectoryUserId(current => (current === result.targetAuthUserId ? null : current))
        showToast('Account deleted successfully.', 'success')
      } else if (result.user) {
        const nextUser = result.user
        setDirectoryResults(current => current.map(item => item.id === nextUser.id ? nextUser : item))
        setSelectedDirectoryUserId(nextUser.id)
        const successMessage =
          action === 'lock_profile' ? 'Profile locked successfully.'
            : action === 'unlock_profile' ? 'Profile unlocked successfully.'
              : action === 'restrict_staff_access' ? 'Hospital access restricted successfully.'
                : action === 'restore_staff_access' ? 'Hospital access restored successfully.'
                  : action === 'close_patient_access' ? 'Patient access closed successfully.'
                    : 'Account updated successfully.'
        showToast(successMessage, 'success')
      }
      await refresh(true)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'This admin action could not be completed right now.'
      showToast(message, 'error')
    } finally {
      setActioning(null)
    }
  }

  const filteredUsers = useMemo(() => (
    (data?.users.recentUsers ?? []).filter(user => matchesQuery([user.email, user.name, user.role], searchQuery))
  ), [data?.users.recentUsers, searchQuery])

  const filteredUploads = useMemo(() => (
    (data?.records.recentUploads ?? []).filter(upload => matchesQuery([upload.fileName, upload.fileType, upload.uploadedBy, upload.uploadedFor], searchQuery))
  ), [data?.records.recentUploads, searchQuery])

  const filteredAlerts = useMemo(() => (
    (data?.alerts ?? []).filter(alert => matchesQuery([alert.title, alert.message, alert.level], searchQuery))
  ), [data?.alerts, searchQuery])

  const filteredIssues = useMemo(() => (
    (data?.sentry.recentIssues ?? []).filter(issue => matchesQuery([issue.title, issue.culprit, issue.level, issue.status], searchQuery))
  ), [data?.sentry.recentIssues, searchQuery])
  const sentryLevelSignals = useMemo(() => (
    (data?.sentry.issuesByLevel ?? []).filter(item => matchesQuery([item.label, item.helper], searchQuery))
  ), [data?.sentry.issuesByLevel, searchQuery])
  const sentryStatusSignals = useMemo(() => (
    (data?.sentry.issuesByStatus ?? []).filter(item => matchesQuery([item.label, item.helper], searchQuery))
  ), [data?.sentry.issuesByStatus, searchQuery])
  const sentryHotspots = useMemo(() => (
    (data?.sentry.topCulprits ?? []).filter(item => matchesQuery([item.label, item.helper], searchQuery))
  ), [data?.sentry.topCulprits, searchQuery])

  const filteredEvents = useMemo(() => (
    (data?.posthog.topEvents ?? [])
      .filter(event => !POSTHOG_WEB_SIGNAL_EVENT_KEYS.has(normalizePosthogEventKey(event.name)))
      .filter(event => matchesQuery([event.name], searchQuery))
  ), [data?.posthog.topEvents, searchQuery])
  const posthogWebSignals = useMemo(() => (
    [
      { key: 'pageviews', label: 'Pageviews', value: data?.posthog.pageviews ?? null, helper: 'Tracked web page views' },
      { key: 'autocaptures', label: 'Autocapture', value: data?.posthog.autocaptures ?? null, helper: 'Captured browser interactions' },
      { key: 'identifies', label: 'Identify Calls', value: data?.posthog.identifies ?? null, helper: 'Identity association events' },
      { key: 'webVitals', label: 'Web Vitals', value: data?.posthog.webVitals ?? null, helper: 'Frontend performance signals' },
    ].filter(signal => matchesQuery([signal.label, signal.helper], searchQuery))
  ), [data?.posthog.autocaptures, data?.posthog.identifies, data?.posthog.pageviews, data?.posthog.webVitals, searchQuery])

  const notificationsCount = filteredAlerts.filter(alert => alert.level !== 'info').length
  const verifiedRate = data?.users.totalUsers ? (data.users.verifiedUsers / data.users.totalUsers) * 100 : null
  const sentryConfigured = Boolean(data?.sentry.configured)
  const posthogConfigured = Boolean(data?.posthog.configured)
  const otpSuccessLabel = data?.security.otpSuccessRate == null ? 'No recent OTP activity' : 'Verification completion rate'
  const otpSuccessHelper = data?.security.otpSuccessRate == null ? 'This updates after signup or reset OTP events are recorded.' : 'OTP completion performance'
  const deploymentReadinessCards = [
    { label: 'Frontend Hosting', value: 'Vercel production deployment is active.', ready: true },
    { label: 'Domain & CDN', value: 'Custom domain is serving through Vercel and Cloudflare.', ready: true },
    { label: 'Backend', value: 'Supabase remains the only backend for admin, patient, and hospital flows.', ready: true },
  ]
  const observabilityCards = [
    {
      label: 'Sentry',
      ready: sentryConfigured,
      value: sentryConfigured ? `Connected to ${data?.sentry.projectLabel ?? 'configured project'}.` : (data?.sentry.message ?? 'Sentry is not configured yet.'),
    },
    {
      label: 'PostHog',
      ready: posthogConfigured,
      value: posthogConfigured ? `Connected to ${data?.posthog.projectLabel ?? 'configured project'}.` : (data?.posthog.message ?? 'PostHog is not configured yet.'),
    },
  ]

  const metricGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 10,
  }
  const dualChartStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: viewportWidth < 1180 ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 12,
  }
  const splitPanelStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: viewportWidth < 1180 ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 12,
  }
  const tableGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: viewportWidth < 1180 ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 12,
  }

  if (loading && !data) {
    return <PageLoader label="Preparing the admin dashboard..." />
  }

  if (!loading && !data) {
    const normalizedError = error?.toLowerCase() ?? ''
    const unauthorized = normalizedError.includes('permission')
    const authRequired = normalizedError.includes('sign in') || normalizedError.includes('401')

    return (
      <AdminLayout
        activeSection={activeSection}
        darkMode={false}
        notificationsCount={0}
        onNotificationsClick={() => undefined}
        onLogout={() => { void logout() }}
        onSearchChange={setSearchQuery}
        onToggleTheme={() => undefined}
        searchQuery={searchQuery}
        sections={sidebarSections}
        title="Dashboard"
        userName={viewerEmail}
      >
        <div style={panelStyle()}>
          <EmptyState
            icon={(
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <rect x="7" y="7" width="26" height="26" rx="8" stroke="currentColor" strokeWidth="1.6" />
                <path d="M20 14v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="20" cy="26" r="1.6" fill="currentColor" />
              </svg>
            )}
            title={unauthorized ? 'Admin access is limited to platform admins.' : authRequired ? 'Sign in to open the admin dashboard.' : 'The admin dashboard could not be loaded right now.'}
            description={unauthorized
              ? 'Promote your user profile to the platform_admin role, then refresh this page to continue.'
              : authRequired
                ? 'Sign in again and refresh this page to continue.'
                : 'Refresh the page to try again. If the issue continues, check the connected analytics services.'}
          />
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
            <Button onClick={() => { void refresh().catch(() => undefined) }}>Retry</Button>
            {authRequired
              ? <Button variant="outline" onClick={() => window.location.assign(ADMIN_LOGIN_PATH)}>Admin sign in</Button>
              : <Button variant="outline" onClick={() => window.location.assign('/')}>Go home</Button>}
          </div>
        </div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout
      activeSection={activeSection}
      darkMode={false}
      notificationsCount={notificationsCount}
      onNotificationsClick={() => document.getElementById('security')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      onLogout={() => { void logout() }}
      onSearchChange={setSearchQuery}
      onToggleTheme={() => undefined}
      searchQuery={searchQuery}
      sections={sidebarSections}
      title="Dashboard"
      userName={viewerEmail}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: 'var(--admin-muted)' }}>
            Updated {formatRelativeTime(data?.checkedAt ?? null)}
            {searchQuery ? ` • Filtered by "${searchQuery}"` : ''}
            {error ? ' • Live data issue detected' : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {windowOptions.map(option => (
              <button
                key={option.key}
                onClick={() => setWindowKey(option.key)}
                style={{
                  border: '1px solid var(--admin-border)',
                  background: option.key === windowKey ? 'rgba(26, 111, 212, 0.08)' : '#fff',
                  color: option.key === windowKey ? 'var(--admin-accent)' : '#7a8899',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {option.label}
              </button>
            ))}
            <Button size="sm" variant="outline" loading={refreshing} onClick={() => { void refresh().catch(() => undefined) }}>
              Refresh
            </Button>
          </div>
        </div>

        <section id="dashboard" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            {sectionLabel('User Metrics')}
            <div style={metricGridStyle}>
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('users')} title="Total Users" value={data?.users.totalUsers ?? null} trendLabel={`+${formatCompact(data?.users.newSignupsWindow ?? null)} in selected window`} trendTone="positive" helper="All registered users" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('plus')} title="New Signups Today" value={data?.users.newSignupsToday ?? null} trendLabel={`${formatCompact(data?.users.newSignupsWindow ?? null)} this window`} trendTone="positive" helper="New accounts created today" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('activity')} title="Active (24h)" value={data?.users.activeUsers24h ?? null} trendLabel={`${formatCompact(data?.users.activeUsersWindow ?? null)} in selected range`} trendTone="critical" helper="Users active in the last day" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('check')} title="Verified Users" value={verifiedRate} valueFormatter={formatPercentage} trendLabel={`${formatCompact(data?.users.unverifiedUsers ?? null)} pending`} trendTone="positive" helper="Verified vs unverified accounts" />
            </div>
          </div>

          <div>
            {sectionLabel('Records & Providers')}
            <div style={metricGridStyle}>
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('records')} title="Total Records" value={data?.records.totalRecords ?? null} trendLabel={`${formatCompact(data?.records.uploadedToday ?? null)} uploaded today`} trendTone="positive" helper="All records stored" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('upload')} title="Uploaded Today" value={data?.records.uploadedToday ?? null} trendLabel={`${formatCompact(data?.providers.recordsUploadedByProviders ?? null)} by providers`} trendTone="positive" helper="Records added today" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('average')} title="Avg per User" value={data?.records.averagePerUser ?? null} valueFormatter={value => value == null ? 'N/A' : value.toFixed(1)} trendLabel={`${formatCompact(data?.users.totalUsers ?? null)} users`} trendTone="positive" helper="Average records per user" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('storage')} title="Storage Used" value={data?.records.storageBytes ?? null} valueFormatter={formatStorage} trendLabel="Attachment footprint" trendTone="neutral" helper="Total storage usage" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('providers')} title="Total Providers" value={data?.providers.totalProviders ?? null} trendLabel={`${formatCompact(data?.providers.totalOrganizations ?? null)} organizations`} trendTone="positive" helper="Hospitals and clinicians onboarded" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('provider-active')} title="Active Providers" value={data?.providers.activeProviders ?? null} trendLabel={`${formatCompact(data?.providers.recordsUploadedByProviders ?? null)} uploads`} trendTone="positive" helper="Providers currently active" />
            </div>
          </div>
        </section>

        <section id="users" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={panelStyle()}>
            {sectionLabel('User Controls')}
            {sectionTitle('User Directory')}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <input
                value={directoryQuery}
                onChange={event => {
                  setDirectoryQuery(event.target.value)
                  if (directoryError) setDirectoryError(null)
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void runDirectorySearch()
                  }
                }}
                placeholder="Search by HID code or email"
                style={{
                  flex: '1 1 320px',
                  minWidth: 240,
                  height: 42,
                  borderRadius: 10,
                  border: '1px solid var(--admin-border)',
                  padding: '0 14px',
                  fontSize: 14,
                  background: '#fff',
                  color: 'var(--admin-text)',
                  outline: 'none',
                }}
              />
              <Button onClick={() => void runDirectorySearch()} loading={directoryLoading}>
                Search
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDirectoryQuery('')
                  setDirectoryResults([])
                  setSelectedDirectoryUserId(null)
                  setDirectoryError(null)
                }}
              >
                Clear
              </Button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--admin-muted)', marginBottom: 12 }}>
              Search by HID code or email to inspect a user profile, lock or unlock the profile, manage staff access, close patient access, or delete the account.
            </div>
            {directoryError && (
              <div style={{ ...alertToneStyle('warning'), borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 11.5 }}>
                {directoryError}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: viewportWidth < 1180 ? '1fr' : 'minmax(280px, 360px) minmax(0, 1fr)', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {directoryResults.length === 0 ? (
                  <EmptyState
                    icon={<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="14" cy="14" r="7.5" stroke="currentColor" strokeWidth="1.5" /><path d="m19.5 19.5 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
                    title="Search for a user"
                    description="Results will appear here after you search with a HID code or email."
                  />
                ) : (
                  directoryResults.map(item => {
                    const selected = selectedDirectoryUserId === item.id
                    const primaryLabel = item.patient?.fullName ?? item.staff?.fullName ?? item.profile?.displayName ?? item.email ?? 'Unknown user'
                    const secondaryLabel = item.patient?.hidCode ?? item.email ?? 'No email'
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedDirectoryUserId(item.id)}
                        style={{
                          border: `1px solid ${selected ? 'rgba(26, 111, 212, 0.28)' : 'var(--admin-border)'}`,
                          borderRadius: 12,
                          background: selected ? 'rgba(26, 111, 212, 0.06)' : '#fff',
                          padding: '12px 14px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--admin-text)' }}>{primaryLabel}</div>
                            <div style={{ fontSize: 11, color: 'var(--admin-muted)', marginTop: 2, wordBreak: 'break-word' }}>{secondaryLabel}</div>
                          </div>
                          <Badge color={item.flags.locked ? 'red' : 'green'}>{item.flags.locked ? 'locked' : 'active'}</Badge>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {item.profile?.appRole && <Badge color="blue">{item.profile.appRole}</Badge>}
                          {item.patient && <Badge color="green">patient</Badge>}
                          {item.staff && <Badge color={item.flags.staffAccessRestricted ? 'amber' : 'green'}>{item.flags.staffAccessRestricted ? 'restricted staff' : 'staff'}</Badge>}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>

              <div style={{ border: '1px solid var(--admin-border)', borderRadius: 12, background: '#fbfdff', padding: 14 }}>
                {!selectedDirectoryUser ? (
                  <EmptyState
                    icon={<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="11" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="M7 26c1-4 5-6 9-6s8 2 9 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
                    title="Choose a user"
                    description="Select a result to inspect the profile and manage the account."
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--admin-text)' }}>
                          {selectedDirectoryUser.patient?.fullName ?? selectedDirectoryUser.staff?.fullName ?? selectedDirectoryUser.profile?.displayName ?? selectedDirectoryUser.email ?? 'Unknown user'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--admin-muted)', marginTop: 4 }}>
                          {selectedDirectoryUser.patient?.hidCode ? `${selectedDirectoryUser.patient.hidCode} • ` : ''}
                          {selectedDirectoryUser.email ?? 'No email available'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {selectedDirectoryUser.profile?.appRole && <Badge color="blue">{selectedDirectoryUser.profile.appRole}</Badge>}
                        <Badge color={selectedDirectoryUser.flags.locked ? 'red' : 'green'}>
                          {selectedDirectoryUser.flags.locked ? 'Locked' : 'Active'}
                        </Badge>
                        {selectedDirectoryUser.staff && (
                          <Badge color={selectedDirectoryUser.flags.staffAccessRestricted ? 'amber' : 'green'}>
                            {selectedDirectoryUser.flags.staffAccessRestricted ? 'Access Restricted' : 'Access Open'}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                      <div style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unread Notifications</div>
                        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{formatCompact(selectedDirectoryUser.stats.unreadNotificationCount)}</div>
                      </div>
                      <div style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active Grants</div>
                        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{formatCompact(selectedDirectoryUser.stats.activeGrantCount)}</div>
                      </div>
                      <div style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pending Requests</div>
                        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{formatCompact(selectedDirectoryUser.stats.pendingRequestCount)}</div>
                      </div>
                      <div style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Records</div>
                        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{formatCompact(selectedDirectoryUser.stats.recordCount)}</div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: viewportWidth < 1180 ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
                      <div style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Profile</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Role</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.profile?.appRole)}</div></div>
                          <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>MFA Required</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{selectedDirectoryUser.profile ? formatBool(selectedDirectoryUser.profile.mfaRequired) : 'Not available'}</div></div>
                          <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Email Confirmed</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{selectedDirectoryUser.emailConfirmedAt ? formatRelativeTime(selectedDirectoryUser.emailConfirmedAt) : 'No'}</div></div>
                          <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Last Sign In</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatRelativeTime(selectedDirectoryUser.lastSignInAt)}</div></div>
                          <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Created</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatRelativeTime(selectedDirectoryUser.profile?.createdAt ?? null)}</div></div>
                          <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Updated</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatRelativeTime(selectedDirectoryUser.profile?.updatedAt ?? null)}</div></div>
                        </div>
                      </div>

                      <div style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{selectedDirectoryUser.patient ? 'Patient Details' : selectedDirectoryUser.staff ? 'Staff Details' : 'Account Details'}</div>
                        {selectedDirectoryUser.patient ? (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Phone</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.patient.phone)}</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Gender</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.patient.gender)}</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Date of Birth</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.patient.dateOfBirth)}</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Profile Completion</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{selectedDirectoryUser.patient.profilePercent}%</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Country</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.patient.country)}</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>State</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.patient.state)}</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Emergency Contact</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.patient.emergencyContactName)}</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Emergency Phone</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.patient.emergencyContactPhone)}</div></div>
                          </div>
                        ) : selectedDirectoryUser.staff ? (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Hospital Name</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.staff.hospitalName)}</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Role</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.staff.role)}</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Phone</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.staff.phone)}</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Verification</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.staff.verificationStatus)}</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>License</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{formatLabelValue(selectedDirectoryUser.staff.licenseNumber)}</div></div>
                            <div><div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Memberships</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{selectedDirectoryUser.staff.activeMembershipCount} active / {selectedDirectoryUser.staff.inactiveMembershipCount} inactive</div></div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>
                            No patient or hospital profile is attached to this account.
                          </div>
                        )}
                      </div>
                    </div>

                    {selectedDirectoryUser.staff && selectedDirectoryUser.staff.memberships.length > 0 && (
                      <div style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Hospital Memberships</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {selectedDirectoryUser.staff.memberships.map(membership => (
                            <div key={membership.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid #eef2f7', borderRadius: 10, padding: '10px 12px' }}>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700 }}>{membership.organizationName ?? 'Unknown organization'}</div>
                                <div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>
                                  {membership.membershipRole} • {membership.appRole}{membership.isPrimary ? ' • primary' : ''}
                                </div>
                              </div>
                              <Badge color={membership.active ? 'green' : 'amber'}>{membership.active ? 'active' : 'inactive'}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Admin Actions</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        <Button
                          variant={selectedDirectoryUser.flags.locked ? 'secondary' : 'outline'}
                          loading={actioning === (selectedDirectoryUser.flags.locked ? 'unlock_profile' : 'lock_profile')}
                          onClick={() => void handleDirectoryAction(selectedDirectoryUser.flags.locked ? 'unlock_profile' : 'lock_profile')}
                          disabled={!selectedDirectoryUser.flags.lockable}
                        >
                          {selectedDirectoryUser.flags.locked ? 'Unlock Profile' : 'Lock Profile'}
                        </Button>
                        {selectedDirectoryUser.staff && (
                          <Button
                            variant={selectedDirectoryUser.flags.staffAccessRestricted ? 'secondary' : 'outline'}
                            loading={actioning === (selectedDirectoryUser.flags.staffAccessRestricted ? 'restore_staff_access' : 'restrict_staff_access')}
                            onClick={() => void handleDirectoryAction(selectedDirectoryUser.flags.staffAccessRestricted ? 'restore_staff_access' : 'restrict_staff_access')}
                            disabled={!selectedDirectoryUser.flags.restrictable}
                          >
                            {selectedDirectoryUser.flags.staffAccessRestricted ? 'Restore Access' : 'Restrict Access'}
                          </Button>
                        )}
                        {selectedDirectoryUser.patient && (
                          <Button
                            variant="outline"
                            loading={actioning === 'close_patient_access'}
                            onClick={() => void handleDirectoryAction('close_patient_access')}
                            disabled={!selectedDirectoryUser.flags.patientAccessOpen}
                          >
                            Close Active Access
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          loading={actioning === 'delete_account'}
                          onClick={() => void handleDirectoryAction('delete_account')}
                          disabled={!selectedDirectoryUser.flags.deletable}
                        >
                          Delete Account
                        </Button>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--admin-muted)', marginTop: 10, lineHeight: 1.6 }}>
                        Locking blocks the profile immediately. Restricting staff access disables hospital access and revokes active grants. Closing patient access revokes current provider access for that patient.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={dualChartStyle}>
            <div style={panelStyle()}>
              {sectionTitle('User Growth')}
              <AdminSeriesChart points={data?.users.growth ?? []} type="line" tone="#5b8def" />
            </div>
            <div id="records" style={panelStyle()}>
              {sectionTitle('Records Uploaded')}
              <AdminSeriesChart points={data?.records.uploads ?? []} type="bar" tone="#22c55e" />
            </div>
          </div>
        </section>

        <section id="providers" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sectionLabel('System Health & Security')}
          <div style={metricGridStyle}>
            <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('api')} title="API Response" value={data?.system.apiResponseTimeMs ?? null} valueFormatter={formatDuration} trendLabel="Latest probe result" trendTone={(data?.system.apiResponseTimeMs ?? 0) > 800 ? 'warning' : 'positive'} helper="Average API response" />
            <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('warning', 'var(--admin-danger)')} title="Error Rate" value={data?.system.errorRate ?? null} valueFormatter={formatPercentage} trendLabel={`${formatCompact(data?.system.failedRequests ?? null)} failed requests`} trendTone={(data?.system.errorRate ?? 0) > 5 ? 'critical' : 'positive'} helper="Observed application errors" />
            <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('uptime')} title="Uptime" value={data?.system.uptimePercent ?? null} valueFormatter={formatPercentage} trendLabel="Service health snapshot" trendTone="positive" helper="Observed availability" />
            <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('failed', 'var(--admin-danger)')} title="Failed Requests" value={data?.system.failedRequests ?? null} trendLabel="Issue-linked failures" trendTone="critical" helper="Failed request count" />
            <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('lock', 'var(--admin-danger)')} title="Failed Logins" value={data?.security.failedLoginAttempts ?? null} trendLabel="Selected window" trendTone="critical" helper="Failed login attempts" />
            <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('check')} title="OTP Success" value={data?.security.otpSuccessRate ?? null} valueFormatter={formatPercentage} trendLabel={otpSuccessLabel} trendTone={data?.security.otpSuccessRate == null ? 'neutral' : (data.security.otpSuccessRate < 50 ? 'warning' : 'positive')} helper={otpSuccessHelper} />
            <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('shield')} title="Suspicious Activity" value={data?.security.suspiciousActivityCount ?? null} trendLabel="Break-glass and auth spikes" trendTone={(data?.security.suspiciousActivityCount ?? 0) > 0 ? 'warning' : 'positive'} helper="Security anomaly count" />
          </div>
        </section>

        <section id="security" style={splitPanelStyle}>
          <div style={panelStyle()}>
            {sectionTitle('User Onboarding Funnel')}
            <AdminFunnelChart steps={data?.users.funnel ?? []} />
          </div>
          <div style={panelStyle()}>
            {sectionTitle('System Alerts')}
            {filteredAlerts.length === 0 ? (
              <EmptyState
                icon={<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M16 5.4 28 26.6H4L16 5.4Z" stroke="currentColor" strokeWidth="1.5" /><path d="M16 12.8v5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="16" cy="22.2" r="1" fill="currentColor" /></svg>}
                title="No active alerts"
                description="The selected window looks stable right now."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredAlerts.map(alert => (
                  <div key={alert.id} style={{ ...alertToneStyle(alert.level), borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{alert.title}</div>
                      <Badge color={alert.level === 'critical' ? 'red' : alert.level === 'warning' ? 'amber' : 'blue'}>{alert.level}</Badge>
                    </div>
                    <div style={{ fontSize: 11.5, lineHeight: 1.6 }}>{alert.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section style={tableGridStyle}>
          <div id="analytics" style={panelStyle()}>
            {sectionTitle('Recent Users')}
            {filteredUsers.length === 0 ? (
              <EmptyState
                icon={<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="11" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="M7 26c1-4 5-6 9-6s8 2 9 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
                title="No users match this filter"
                description="Adjust the search or date range to see more activity."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: viewportWidth < 1320 ? '1fr 1fr 1fr' : '1.2fr 1.1fr 0.7fr 0.9fr', gap: 10, padding: '0 0 8px', borderBottom: '1px solid var(--admin-border)' }}>
                  {tableHeaderCell('Name')}
                  {tableHeaderCell('Email')}
                  {tableHeaderCell('Status')}
                  {tableHeaderCell('Time')}
                </div>
                {filteredUsers.map(user => (
                  <div key={user.id} style={{ display: 'grid', gridTemplateColumns: viewportWidth < 1320 ? '1fr 1fr 1fr' : '1.2fr 1.1fr 0.7fr 0.9fr', gap: 10, padding: '10px 0', borderBottom: '1px solid #f0f4f8', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{user.name ?? user.email ?? 'Unknown user'}</div>
                      {viewportWidth < 1320 && <div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>{user.role ?? 'patient'}</div>}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--admin-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email ?? 'No email'}</div>
                    <div>
                      <Badge color={statusBadgeColor(user.status)}>{user.status}</Badge>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>{formatRelativeTime(user.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={panelStyle()}>
            {sectionTitle('Recent Uploads')}
            {filteredUploads.length === 0 ? (
              <EmptyState
                icon={<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M16 21V9m0 0-4 4m4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><rect x="7" y="22" width="18" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.5" /></svg>}
                title="No uploads match this filter"
                description="Recent uploads will appear here as records are added."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: viewportWidth < 1320 ? '1fr 1fr 1fr' : '1.1fr 0.8fr 0.8fr 0.7fr', gap: 10, padding: '0 0 8px', borderBottom: '1px solid var(--admin-border)' }}>
                  {tableHeaderCell('User')}
                  {tableHeaderCell('Type')}
                  {tableHeaderCell('Provider')}
                  {tableHeaderCell('Time')}
                </div>
                {filteredUploads.map(upload => (
                  <div key={upload.id} style={{ display: 'grid', gridTemplateColumns: viewportWidth < 1320 ? '1fr 1fr 1fr' : '1.1fr 0.8fr 0.8fr 0.7fr', gap: 10, padding: '10px 0', borderBottom: '1px solid #f0f4f8', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{upload.uploadedFor ?? 'Unknown patient'}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>{upload.fileName}</div>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>{upload.fileType ?? 'Unknown type'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>{upload.uploadedBy ?? 'System user'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>{formatRelativeTime(upload.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section style={splitPanelStyle}>
          <div style={panelStyle()}>
            {sectionLabel('Sentry')}
            {sectionTitle('Error Monitoring')}
            <div style={{ ...metricGridStyle, marginBottom: 12 }}>
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('warning', 'var(--admin-danger)')} title="Unresolved Issues" value={data?.sentry.unresolvedIssues ?? null} trendLabel={data?.sentry.projectLabel ?? 'Sentry project'} trendTone={data?.sentry.message ? 'warning' : 'positive'} helper="Open issues in selected window" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('failed', 'var(--admin-danger)')} title="Issue Hits" value={data?.sentry.issueEvents ?? null} trendLabel={`${formatCompact(data?.sentry.affectedUsers ?? null)} affected users`} trendTone="critical" helper="Total recent issue events" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('shield', 'var(--admin-danger)')} title="Critical Issues" value={data?.sentry.criticalIssues ?? null} trendLabel={data?.sentry.mostRecentIssueAt ? `Last seen ${formatRelativeTime(data.sentry.mostRecentIssueAt)}` : 'No recent critical issue'} trendTone={(data?.sentry.criticalIssues ?? 0) > 0 ? 'critical' : 'positive'} helper="Fatal and error-level issues" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('users')} title="Affected Users" value={data?.sentry.affectedUsers ?? null} trendLabel={`${formatCompact(filteredIssues.length)} active issue groups`} trendTone={(data?.sentry.affectedUsers ?? 0) > 0 ? 'warning' : 'positive'} helper="Users touched by recent issues" />
            </div>
            {data?.sentry.message && (
              <div style={{ ...alertToneStyle('warning'), borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 11.5 }}>
                {data.sentry.message}
              </div>
            )}
            <AdminSeriesChart points={data?.sentry.trend ?? []} type="line" tone="#5b8def" />
            <div style={{ ...splitPanelStyle, marginTop: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--admin-text)' }}>Issue Severity Mix</div>
                {sentryLevelSignals.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>No matching severity data in this window.</div>
                ) : (
                  sentryLevelSignals.map(item => (
                    <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{item.label}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>{item.helper ?? 'Observed issue groups'}</div>
                      </div>
                      <Badge color={item.label === 'Fatal' || item.label === 'Error' ? 'red' : item.label === 'Warning' ? 'amber' : 'blue'}>{formatCompact(item.value)}</Badge>
                    </div>
                  ))
                )}
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--admin-text)', marginTop: 4 }}>Issue Status</div>
                {sentryStatusSignals.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>No matching issue status data in this window.</div>
                ) : (
                  sentryStatusSignals.map(item => (
                    <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{item.label}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>{item.helper ?? 'Observed issue groups'}</div>
                      </div>
                      <Badge color={item.label === 'Unresolved' ? 'red' : item.label === 'Resolved' ? 'green' : 'amber'}>{formatCompact(item.value)}</Badge>
                    </div>
                  ))
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--admin-text)' }}>Issue Hotspots</div>
                {sentryHotspots.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>No matching Sentry hotspots in this window.</div>
                ) : (
                  sentryHotspots.map(item => (
                    <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>{item.helper ?? 'Observed issue groups'}</div>
                      </div>
                      <Badge color="amber">{formatCompact(item.value)}</Badge>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {filteredIssues.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>
                  {sentryConfigured ? 'No actionable Sentry issues in this range.' : 'Sentry is not configured for this environment.'}
                </div>
              ) : (
                filteredIssues.slice(0, 5).map(issue => (
                  <div key={issue.id} style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{issue.title}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>{issue.culprit ?? 'No culprit provided'}</div>
                      </div>
                      <Badge color={issue.level === 'error' || issue.level === 'fatal' ? 'red' : 'amber'}>{issue.level ?? 'issue'}</Badge>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', marginTop: 8 }}>
                      {issue.count} hits • {issue.users} users • {formatRelativeTime(issue.lastSeen)}
                    </div>
                  </div>
                ))
              )}
            </div>
            {data?.sentry.externalUrl && (
              <div style={{ marginTop: 12 }}>
                <Button size="sm" variant="outline" onClick={() => window.open(data.sentry.externalUrl!, '_blank', 'noopener,noreferrer')}>
                  Open Sentry
                </Button>
              </div>
            )}
          </div>

          <div style={panelStyle()}>
            {sectionLabel('PostHog')}
            {sectionTitle('Product Analytics')}
            <div style={{ ...metricGridStyle, marginBottom: 12 }}>
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('analytics')} title="Tracked Events" value={data?.posthog.events ?? null} trendLabel={data?.posthog.projectLabel ?? 'PostHog project'} trendTone={data?.posthog.message ? 'warning' : 'positive'} helper="Selected window" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('users')} title="Unique Users" value={data?.posthog.uniqueUsers ?? null} trendLabel={`${filteredEvents.length} top events`} trendTone="positive" helper="Unique users in range" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('analytics')} title="Pageviews" value={data?.posthog.pageviews ?? null} trendLabel="Web traffic activity" trendTone="positive" helper="Observed $pageview events" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('activity')} title="Autocapture" value={data?.posthog.autocaptures ?? null} trendLabel="Browser interaction tracking" trendTone="positive" helper="Observed $autocapture events" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('check')} title="Identify Calls" value={data?.posthog.identifies ?? null} trendLabel="Known-user attribution" trendTone="positive" helper="Observed $identify events" />
              <AdminMetricCard accent="var(--admin-accent)" icon={metricIcon('activity')} title="Web Vitals" value={data?.posthog.webVitals ?? null} trendLabel="Performance telemetry" trendTone="positive" helper="Frontend web performance events" />
            </div>
            {data?.posthog.message && (
              <div style={{ ...alertToneStyle('warning'), borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 11.5 }}>
                {data.posthog.message}
              </div>
            )}
            <div style={{ ...splitPanelStyle, marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--admin-text)', marginBottom: 8 }}>All Event Trend</div>
                <AdminSeriesChart points={data?.posthog.trend ?? []} type="bar" tone="#22c55e" />
              </div>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--admin-text)', marginBottom: 8 }}>Pageview Trend</div>
                <AdminSeriesChart points={data?.posthog.pageviewTrend ?? []} type="line" tone="#1a6fd4" />
              </div>
            </div>
            <div style={{ ...splitPanelStyle, marginTop: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--admin-text)' }}>Top Events</div>
                {filteredEvents.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>No matching custom PostHog events.</div>
                ) : (
                  filteredEvents.slice(0, 6).map(event => (
                    <div key={event.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{event.name}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>Observed in selected range</div>
                      </div>
                      <Badge color="green">{formatCompact(event.total)}</Badge>
                    </div>
                  ))
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--admin-text)' }}>Web Analytics Signals</div>
                {posthogWebSignals.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--admin-muted)' }}>No matching PostHog web analytics metrics.</div>
                ) : (
                  posthogWebSignals.map(signal => (
                    <div key={signal.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{signal.label}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--admin-muted)' }}>{signal.helper}</div>
                      </div>
                      <Badge color="blue">{formatCompact(signal.value)}</Badge>
                    </div>
                  ))
                )}
              </div>
            </div>
            {data?.posthog.externalUrl && (
              <div style={{ marginTop: 12 }}>
                <Button size="sm" variant="outline" onClick={() => window.open(data.posthog.externalUrl!, '_blank', 'noopener,noreferrer')}>
                  Open PostHog
                </Button>
              </div>
            )}
          </div>
        </section>

        <section id="settings" style={panelStyle()}>
          {sectionLabel('Settings')}
          {sectionTitle('Deploy Readiness')}
          <div style={{ display: 'grid', gridTemplateColumns: viewportWidth < 1180 ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {deploymentReadinessCards.map(card => (
                <div key={card.label} style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px', background: '#fbfdff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{card.label}</div>
                    <Badge color={readinessTone(card.ready)}>{card.ready ? 'ready' : 'attention'}</Badge>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>{card.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {observabilityCards.map(card => (
                <div key={card.label} style={{ border: '1px solid var(--admin-border)', borderRadius: 10, padding: '10px 12px', background: '#fbfdff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{card.label}</div>
                    <Badge color={readinessTone(card.ready)}>{card.ready ? 'connected' : 'needs setup'}</Badge>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>{card.value}</div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--admin-muted)', lineHeight: 1.7 }}>
                The admin dashboard uses live Supabase data, and the observability panels reflect the current Sentry and PostHog connection state.
              </div>
            </div>
          </div>
        </section>
      </div>
    </AdminLayout>
  )
}
