import React, { Component, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { HIDLogo } from './components/HIDLogo'
import { RouteObservability } from './components/RouteObservability'
import { SessionBootstrap } from './components/SessionBootstrap'
import { ToastProvider } from './components/ui'
import { captureException } from './lib/observability'
import {
  AdminDashboardPage,
  AdminLoginPage,
  DoctorAccessPage,
  DoctorAuthPage,
  DoctorDashboardPage,
  DoctorEmergencyPage,
  DoctorHistoryPage,
  DoctorPatientRecordsPage,
  LandingPage,
  PatientAuthPage,
  PatientHistoryPage,
  PatientNotificationsPage,
  PatientProfilePage,
  PatientRecordsPage,
} from './lib/routePreload'
import {
  ADMIN_LOGIN_PATH,
  ADMIN_OVERVIEW_PATH,
  ADMIN_ROOT_PATH,
  LEGACY_ADMIN_LOGIN_PATH,
  LEGACY_ADMIN_OVERVIEW_PATH,
  LEGACY_ADMIN_ROOT_PATH,
} from './lib/adminRoutes'
import { isConfigured } from './lib/supabase'
import {
  HOSPITAL_ACCESS_PATH,
  HOSPITAL_AUTH_PATH,
  HOSPITAL_DASHBOARD_PATH,
  HOSPITAL_EMERGENCY_PATH,
  HOSPITAL_HISTORY_PATH,
  HOSPITAL_ROOT_PATH,
} from './lib/hospitalRoutes'

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    captureException(error, {
      componentStack: errorInfo.componentStack,
    })
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, background: '#f3f4f6' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 40, maxWidth: 520, width: '100%', border: '1px solid #e5e7eb', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>!</div>
            <h2 style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Something went wrong</h2>
            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>We could not load this page right now. Please refresh and try again.</p>
            <button
              onClick={() => window.location.reload()}
              style={{ background: '#1a6fd4', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function SetupBanner() {
  if (isConfigured) return null

  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, background: '#1e3a5f', color: '#fff', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16, fontSize: 13 }}>
      <span>[!]</span>
      <div style={{ flex: 1 }}>
        <strong>Supabase not connected.</strong> Create a <code style={{ background: 'rgba(255,255,255,0.15)', padding: '1px 6px', borderRadius: 4 }}>.env</code> file with your Supabase URL and anon key. See <code style={{ background: 'rgba(255,255,255,0.15)', padding: '1px 6px', borderRadius: 4 }}>.env.example</code>.
      </div>
      <a
        href="https://supabase.com"
        target="_blank"
        rel="noreferrer"
        style={{ background: '#1a6fd4', color: '#fff', padding: '7px 16px', borderRadius: 8, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
      >
        Get Supabase Keys
      </a>
    </div>
  )
}

function RouteLoadingScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #f8fbff 0%, #f2f6fb 100%)', padding: 24 }}>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 14, padding: '28px 24px', borderRadius: 28, background: '#fff', border: '1px solid #e5e7eb', color: '#4b5563', fontSize: 14, fontWeight: 600, boxShadow: '0 18px 38px rgba(15, 23, 42, 0.06)' }}>
        <HIDLogo size="sm" />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #dbe3ef', borderTopColor: '#1a6fd4', display: 'inline-block', animation: 'hid-spin 0.8s linear infinite' }} />
          Loading your page...
        </div>
      </div>
      <style>{'@keyframes hid-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
    </div>
  )
}

function LegacyDoctorPatientRecordsRedirect() {
  const { hidCode = '' } = useParams()
  return <Navigate to={`/hospital/patient-records/${hidCode}`} replace />
}

function LegacyDoctorHistoryRedirect() {
  return <Navigate to={HOSPITAL_HISTORY_PATH} replace />
}

function LegacyDoctorEmergencyRedirect() {
  return <Navigate to={HOSPITAL_EMERGENCY_PATH} replace />
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider />
        <SessionBootstrap />
        <RouteObservability />
        <SetupBanner />
        <Suspense fallback={<RouteLoadingScreen />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/signup" element={<Navigate to="/patient" replace />} />
            <Route path="/login" element={<Navigate to="/patient" replace />} />
            <Route path="/dashboard" element={<Navigate to={HOSPITAL_DASHBOARD_PATH} replace />} />
            <Route path="/register" element={<Navigate to="/patient" replace />} />
            <Route path="/doctor" element={<Navigate to={HOSPITAL_DASHBOARD_PATH} replace />} />
            <Route path="/records" element={<Navigate to="/patient/records" replace />} />
            <Route path="/logs" element={<Navigate to="/patient/history" replace />} />
            <Route path="/patient" element={<PatientAuthPage />} />
            <Route path="/patient/profile" element={<PatientProfilePage />} />
            <Route path="/patient/records" element={<PatientRecordsPage />} />
            <Route path="/patient/history" element={<PatientHistoryPage />} />
            <Route path="/patient/notifications" element={<PatientNotificationsPage />} />
            <Route path={ADMIN_ROOT_PATH} element={<Navigate to={ADMIN_LOGIN_PATH} replace />} />
            <Route path={ADMIN_LOGIN_PATH} element={<AdminLoginPage />} />
            <Route path={ADMIN_OVERVIEW_PATH} element={<AdminDashboardPage />} />
            <Route path={LEGACY_ADMIN_ROOT_PATH} element={<Navigate to={ADMIN_LOGIN_PATH} replace />} />
            <Route path={LEGACY_ADMIN_LOGIN_PATH} element={<Navigate to={ADMIN_LOGIN_PATH} replace />} />
            <Route path={LEGACY_ADMIN_OVERVIEW_PATH} element={<Navigate to={ADMIN_OVERVIEW_PATH} replace />} />
            <Route path={HOSPITAL_ROOT_PATH} element={<Navigate to={HOSPITAL_AUTH_PATH} replace />} />
            <Route path={HOSPITAL_AUTH_PATH} element={<DoctorAuthPage />} />
            <Route path={HOSPITAL_DASHBOARD_PATH} element={<DoctorDashboardPage />} />
            <Route path={HOSPITAL_ACCESS_PATH} element={<DoctorAccessPage />} />
            <Route path={HOSPITAL_HISTORY_PATH} element={<DoctorHistoryPage />} />
            <Route path={HOSPITAL_EMERGENCY_PATH} element={<DoctorEmergencyPage />} />
            <Route path="/hospital/patient-records/:hidCode" element={<DoctorPatientRecordsPage />} />
            <Route path="/patient/auth" element={<Navigate to="/patient" replace />} />
            <Route path="/doctor/auth" element={<Navigate to={HOSPITAL_AUTH_PATH} replace />} />
            <Route path="/doctor/access" element={<Navigate to={HOSPITAL_ACCESS_PATH} replace />} />
            <Route path="/doctor/history" element={<LegacyDoctorHistoryRedirect />} />
            <Route path="/doctor/emergency" element={<LegacyDoctorEmergencyRedirect />} />
            <Route path="/doctor/patient-records/:hidCode" element={<LegacyDoctorPatientRecordsRedirect />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
