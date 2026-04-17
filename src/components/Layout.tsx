import React, { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { HIDLogo } from './HIDLogo'

const nav = [
  { path: '/dashboard', label: 'Home',
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 7l7-6 7 6v9a1 1 0 01-1 1H3a1 1 0 01-1-1V7z" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M7 18v-6h4v6" stroke="currentColor" strokeWidth="1.5"/></svg> },
  { path: '/register', label: 'Register Patient',
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M2 16c0-4 14-4 14 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M14 3v6M11 6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { path: '/doctor', label: 'Doctor Access',
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="2" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M6 7h6M6 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M6 4h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> },
  { path: '/records', label: 'Medical Records',
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="3" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M6 9h4M9 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M6 2v3M12 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M2 8h14" stroke="currentColor" strokeWidth="1.3"/></svg> },
  { path: '/logs', label: 'Access Logs',
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 1a8 8 0 100 16A8 8 0 009 1z" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M9 5v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
]

export function Layout({ children, title, subtitle }: {
  children: React.ReactNode; title: string; subtitle?: string
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [isCompact, setIsCompact] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 980 : false))

  useEffect(() => {
    const handleResize = () => setIsCompact(window.innerWidth < 980)
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: isCompact ? 'column' : 'row', minHeight: '100vh' }}>
      <aside style={{
        width: isCompact ? '100%' : 228,
        minHeight: isCompact ? 'auto' : '100vh',
        background: '#fff',
        borderRight: isCompact ? 'none' : '1px solid #e5e7eb',
        borderBottom: isCompact ? '1px solid #e5e7eb' : 'none',
        display: 'flex',
        flexDirection: 'column',
        padding: isCompact ? '14px 12px' : '20px 12px',
        position: isCompact ? 'relative' : 'fixed',
        top: isCompact ? 'auto' : 0,
        left: isCompact ? 'auto' : 0,
        zIndex: 50
      }}>
        <div style={{ padding: isCompact ? '4px 8px 14px' : '4px 8px 24px', cursor: 'pointer' }} onClick={() => navigate('/dashboard')}>
          <HIDLogo size="sm" />
        </div>

        <nav style={{ display: 'grid', gridTemplateColumns: isCompact ? 'repeat(auto-fit, minmax(140px, 1fr))' : '1fr', gap: 6, flex: 1 }}>
          {nav.map(item => {
            const active = pathname === item.path
            return (
              <button key={item.path} onClick={() => navigate(item.path)} style={{
                display: 'flex', alignItems: 'center', justifyContent: isCompact ? 'center' : 'flex-start', gap: 10,
                padding: '10px 12px', borderRadius: 10, border: 'none',
                background: active ? '#e8f1fc' : 'transparent',
                color: active ? '#1a6fd4' : '#374151',
                fontWeight: active ? 600 : 400, fontSize: 14,
                textAlign: isCompact ? 'center' : 'left', cursor: 'pointer',
                transition: 'all 0.15s', width: '100%'
              }}>
                <span style={{ opacity: active ? 1 : 0.6 }}>{item.icon}</span>
                {item.label}
              </button>
            )
          })}
        </nav>

        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
          <div style={{ fontSize: 11, color: '#9ca3af', padding: '0 8px', lineHeight: 1.6 }}>
            <strong style={{ color: '#6b7280' }}>HID</strong><br/>Health Identity Directory
          </div>
        </div>
      </aside>

      <main style={{ marginLeft: isCompact ? 0 : 228, flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <div style={{
          minHeight: 64, background: '#fff', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', padding: isCompact ? '14px 16px' : '0 32px',
          justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 40, gap: 12, flexWrap: 'wrap'
        }}>
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px' }}>{title}</h1>
            {subtitle && <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>{subtitle}</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HIDLogo size="xs" />
          </div>
        </div>

        <div style={{ flex: 1, padding: isCompact ? 16 : 32, background: '#f3f4f6' }}>
          {children}
        </div>
      </main>
    </div>
  )
}
