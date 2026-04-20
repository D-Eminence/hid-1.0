export type AdminOverviewWindow = '24h' | '7d' | '30d'

export interface AdminMetricPoint {
  timestamp: string
  value: number
}

export interface AdminRecentUser {
  id: string
  email: string | null
  name: string | null
  role: string | null
  status: 'verified' | 'unverified'
  createdAt: string
  lastSignInAt: string | null
}

export interface AdminRecentUpload {
  id: string
  fileName: string
  fileType: string | null
  uploadedBy: string | null
  uploadedFor: string | null
  createdAt: string
}

export interface AdminAlert {
  id: string
  level: 'info' | 'warning' | 'critical'
  title: string
  message: string
}

export interface AdminFunnelStep {
  key: string
  label: string
  value: number
  conversionFromPrevious: number | null
}

export interface AdminSentryIssue {
  id: string
  title: string
  culprit: string | null
  count: number
  users: number
  level: string | null
  status: string | null
  lastSeen: string | null
  permalink: string | null
}

export interface AdminPosthogEvent {
  name: string
  total: number
}

export interface AdminBreakdownItem {
  key: string
  label: string
  value: number
  helper?: string | null
}

export interface AdminObservabilityProviderBase {
  configured: boolean
  message: string | null
  externalUrl: string | null
}

export interface AdminSentryOverview extends AdminObservabilityProviderBase {
  affectedUsers: number | null
  criticalIssues: number | null
  issueEvents: number | null
  issuesByLevel: AdminBreakdownItem[]
  issuesByStatus: AdminBreakdownItem[]
  mostRecentIssueAt: string | null
  projectLabel: string | null
  recentIssues: AdminSentryIssue[]
  topCulprits: AdminBreakdownItem[]
  trend: AdminMetricPoint[]
  unresolvedIssues: number | null
}

export interface AdminPosthogOverview extends AdminObservabilityProviderBase {
  autocaptures: number | null
  events: number | null
  identifies: number | null
  pageviewTrend: AdminMetricPoint[]
  pageviews: number | null
  projectLabel: string | null
  topEvents: AdminPosthogEvent[]
  trend: AdminMetricPoint[]
  uniqueUsers: number | null
  webVitals: number | null
}

export interface AdminUserMetrics {
  totalUsers: number
  newSignupsToday: number
  newSignupsWindow: number
  activeUsers24h: number
  activeUsersWindow: number
  verifiedUsers: number
  unverifiedUsers: number
  growth: AdminMetricPoint[]
  recentUsers: AdminRecentUser[]
  funnel: AdminFunnelStep[]
}

export interface AdminRecordMetrics {
  totalRecords: number
  uploadedToday: number
  averagePerUser: number
  storageBytes: number
  uploads: AdminMetricPoint[]
  recentUploads: AdminRecentUpload[]
}

export interface AdminProviderMetrics {
  totalOrganizations: number
  totalProviders: number
  activeProviders: number
  recordsUploadedByProviders: number
}

export interface AdminSecurityMetrics {
  failedLoginAttempts: number
  otpSuccessRate: number | null
  suspiciousActivityCount: number
}

export interface AdminSystemMetrics {
  apiResponseTimeMs: number | null
  errorRate: number | null
  failedRequests: number | null
  uptimePercent: number | null
}

export interface AdminDashboardOverview {
  alerts: AdminAlert[]
  checkedAt: string
  posthog: AdminPosthogOverview
  providers: AdminProviderMetrics
  records: AdminRecordMetrics
  security: AdminSecurityMetrics
  sentry: AdminSentryOverview
  system: AdminSystemMetrics
  users: AdminUserMetrics
  window: AdminOverviewWindow
}
