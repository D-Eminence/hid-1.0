import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { HIDLogo } from './HIDLogo'
import {
  HOSPITAL_ACCESS_PATH,
  HOSPITAL_DASHBOARD_PATH,
  HOSPITAL_EMERGENCY_PATH,
  HOSPITAL_HISTORY_PATH,
} from '../lib/hospitalRoutes'

type HospitalSection = 'dashboard' | 'access' | 'history' | 'emergency'

const hospitalNav = [
  {
    section: 'dashboard' as const,
    path: HOSPITAL_DASHBOARD_PATH,
    label: 'Dashboard',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M2 7l7-6 7 6v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M7 17v-5h4v5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    section: 'access' as const,
    path: HOSPITAL_ACCESS_PATH,
    label: 'Patient Access',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="3" y="2" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M6 7h6M6 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 4h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    section: 'history' as const,
    path: HOSPITAL_HISTORY_PATH,
    label: 'Access Logs',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 1a8 8 0 1 0 0 16A8 8 0 0 0 9 1z" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M9 5v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    section: 'emergency' as const,
    path: HOSPITAL_EMERGENCY_PATH,
    label: 'Emergency',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2.2 15.4 14a1 1 0 0 1-.88 1.5H3.48A1 1 0 0 1 2.6 14L9 2.2Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M9 6.2v4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="9" cy="13.2" r=".9" fill="currentColor" />
      </svg>
    ),
  },
]

export function HospitalLayout({
  activeSection,
  children,
  title,
  subtitle,
  onLogout,
  userName,
}: {
  activeSection: HospitalSection
  children: React.ReactNode
  title: string
  subtitle?: string
  onLogout?: () => void
  userName?: string | null
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 228,
          minHeight: '100vh',
          background: '#fff',
          borderRight: '1px solid #e5e7eb',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 12px',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 50,
        }}
      >
        <div style={{ padding: '4px 8px 24px', cursor: 'pointer' }} onClick={() => navigate(HOSPITAL_DASHBOARD_PATH)}>
          <HIDLogo size="sm" />
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {hospitalNav.map(item => {
            const active = activeSection === item.section || (item.section === 'access' && pathname.startsWith('/hospital/patient-records/'))
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: active ? '#e8f1fc' : 'transparent',
                  color: active ? '#1a6fd4' : '#374151',
                  fontWeight: active ? 600 : 400,
                  fontSize: 14,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  width: '100%',
                }}
              >
                <span style={{ opacity: active ? 1 : 0.6 }}>{item.icon}</span>
                {item.label}
              </button>
            )
          })}
        </nav>

        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
          {userName && (
            <div style={{ fontSize: 11, color: '#6b7280', padding: '0 8px 10px', lineHeight: 1.6 }}>
              <strong style={{ color: '#374151' }}>{userName}</strong>
            </div>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              style={{
                width: '100%',
                border: '1px solid #e5e7eb',
                background: '#fff5f5',
                color: '#b91c1c',
                borderRadius: 8,
                padding: '9px 12px',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Logout
            </button>
          )}
          <div style={{ fontSize: 11, color: '#9ca3af', padding: '12px 8px 0', lineHeight: 1.6 }}>
            <strong style={{ color: '#6b7280' }}>HID</strong>
            <br />
            Health Identity Directory
          </div>
        </div>
      </aside>

      <main style={{ marginLeft: 228, flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <div
          style={{
            height: 64,
            background: '#fff',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            padding: '0 32px',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 40,
          }}
        >
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px' }}>{title}</h1>
            {subtitle && <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>{subtitle}</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HIDLogo size="xs" />
          </div>
        </div>

        <div style={{ flex: 1, padding: 32, background: '#f3f4f6' }}>{children}</div>
      </main>
    </div>
  )
}
