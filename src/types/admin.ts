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
  totalPatients: number
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
  selectedDate: string | null
  system: AdminSystemMetrics
  users: AdminUserMetrics
  window: AdminOverviewWindow
}

export type AdminUserManagementAction =
  | 'lock_profile'
  | 'unlock_profile'
  | 'restrict_staff_access'
  | 'restore_staff_access'
  | 'close_patient_access'
  | 'restore_account'
  | 'delete_account'

export interface AdminManagedUserProfile {
  id: string
  authUserId: string
  appRole: string | null
  displayName: string | null
  active: boolean
  deletedAt: string | null
  deletedByUserProfileId: string | null
  deletedReason: string | null
  mfaRequired: boolean
  createdAt: string
  restoredAt: string | null
  restoredByUserProfileId: string | null
  updatedAt: string
}

export interface AdminManagedPatient {
  id: string
  authUserId: string
  userProfileId: string
  hidCode: string
  fullName: string
  email: string | null
  phone: string | null
  gender: string | null
  dateOfBirth: string | null
  country: string | null
  state: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  profilePercent: number
  notificationsEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface AdminManagedStaffMembership {
  id: string
  organizationId: string
  organizationName: string | null
  membershipRole: string
  appRole: string
  isPrimary: boolean
  active: boolean
  createdAt: string
}

export interface AdminManagedStaff {
  id: string
  authUserId: string
  userProfileId: string
  fullName: string
  email: string
  phone: string | null
  hospitalName: string | null
  verificationStatus: string
  licenseNumber: string | null
  role: string
  active: boolean
  createdAt: string
  updatedAt: string
  memberships: AdminManagedStaffMembership[]
  activeMembershipCount: number
  inactiveMembershipCount: number
}

export interface AdminManagedUserStats {
  activeGrantCount: number
  pendingRequestCount: number
  recordCount: number
  unreadNotificationCount: number
}

export interface AdminManagedUserFlags {
  deleted: boolean
  locked: boolean
  deletable: boolean
  lockable: boolean
  patientAccessOpen: boolean | null
  restrictable: boolean
  restorable: boolean
  staffAccessRestricted: boolean | null
}

export interface AdminManagedUser {
  id: string
  email: string | null
  emailConfirmedAt: string | null
  lastSignInAt: string | null
  profile: AdminManagedUserProfile | null
  patient: AdminManagedPatient | null
  staff: AdminManagedStaff | null
  stats: AdminManagedUserStats
  flags: AdminManagedUserFlags
}

export interface AdminUserDirectoryResponse {
  matches: AdminManagedUser[]
}

export type AdminUsersExportFormat = 'csv' | 'xlsx' | 'pdf' | 'txt'

export type AdminUsersExportScope =
  | 'selected_user'
  | 'search_results'
  | 'selected_day'
  | 'last_7_days'
  | 'last_30_days'
  | 'all'

export interface AdminUsersExportFilters {
  scope: AdminUsersExportScope
  authUserId?: string | null
  query?: string | null
  date?: string | null
}

export interface AdminUsersExportStartResponse {
  challengeId: string
  deliveryChannels: Array<'email'>
  expiresAt: string
  maskedEmail: string | null
}

export interface AdminUserActionResponse {
  deleted: boolean
  targetAuthUserId: string
  user: AdminManagedUser | null
}

export interface AdminPlatformAdmin {
  profileId: string
  authUserId: string
  displayName: string | null
  email: string | null
  emailConfirmedAt: string | null
  lastSignInAt: string | null
  active: boolean
  mfaRequired: boolean
  createdAt: string
  updatedAt: string
}

export interface AdminStaffRolePolicy {
  role: string
  canOpenDashboard: boolean
  canUseStandardAccess: boolean
  canViewPatientRecords: boolean
  canCreateRecords: boolean
  canUseBreakGlass: boolean
  canViewHistory: boolean
  updatedAt: string
  updatedByUserProfileId: string | null
}

export interface AdminOutreachRolePolicy {
  role: string
  canOpenWorkspace: boolean
  canCreateEncounters: boolean
  canManageInvites: boolean
  canSyncData: boolean
  canViewCampaignData: boolean
  updatedAt: string
  updatedByUserProfileId: string | null
}

export interface AdminRoleManagementResponse {
  admins: AdminPlatformAdmin[]
  staffRolePolicies: AdminStaffRolePolicy[]
  outreachRolePolicies: AdminOutreachRolePolicy[]
}

export interface AdminCreatePlatformAdminResponse {
  admin: AdminPlatformAdmin
  passwordSetupLink: string
  verificationType: string | null
}

export interface AdminPlatformControls {
  maintenanceMode: boolean
  patientSignupEnabled: boolean
  hospitalSignupEnabled: boolean
  patientPortalEnabled: boolean
  hospitalPortalEnabled: boolean
  outreachSignupEnabled: boolean
  outreachPortalEnabled: boolean
  breakGlassEnabled: boolean
  uploadsEnabled: boolean
  updatedAt: string
  updatedByUserProfileId: string | null
  updatedByName: string | null
  updatedByEmail: string | null
  outreach?: {
    summary: {
      activeCampaigns: number
      plannedCampaigns: number
      closedCampaigns: number
      workers: number
      openInvites: number
      encounters: number
      queuedEncounters: number
      referrals: number
      urgentReferrals: number
    }
    campaigns: Array<{
      id: string
      name: string
      org: string
      location: string
      status: string
      startsAt: string
      endsAt: string | null
      createdAt: string
    }>
    workers: Array<{
      id: string
      displayName: string
      role: string
      campaignId: string
      createdAt: string
    }>
    invites: Array<{
      id: string
      campaignId: string
      role: string
      useCount: number
      maxUses: number
      expiresAt: string | null
      createdAt: string
      active: boolean
    }>
  }
}

export interface AdminPlatformControlsResponse {
  controls: AdminPlatformControls
}
