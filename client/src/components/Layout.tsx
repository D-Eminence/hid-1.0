import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { HIDLogo } from './HIDLogo'

const navItems = [
  { path: '/app', label: 'Home', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 7l7-6 7 6v9a1 1 0 01-1 1H3a1 1 0 01-1-1V7z" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M7 18v-6h4v6" stroke="currentColor" strokeWidth="1.5"/></svg> },
  { path: '/app/register', label: 'Register Patient', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M2 16c0-4 14-4 14 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M14 3v6M11 6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { path: '/app/doctor', label: 'Doctor Access', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="2" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M6 7h6M6 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { path: '/app/records', label: 'Medical Records', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="3" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M6 9h4M9 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M6 2v3M12 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M2 8h14" stroke="currentColor" strokeWidth="1.3"/></svg> },
  { path: '/app/logs', label: 'Access Logs', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 1a8 8 0 100 16A8 8 0 009 1z" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M9 5v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
]

export function Layout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  const nav = useNavigate()
  const { pathname } = useLocation()
  return (
    <div style={{ display:'flex', minHeight:'100vh' }}>
      {/* Sidebar */}
      <aside style={{ width:228, minHeight:'100vh', background:'#fff', borderRight:'1px solid #e5e7eb', display:'flex', flexDirection:'column', padding:'20px 12px', position:'fixed', top:0, left:0, zIndex:50 }}>
        <div style={{ padding:'4px 8px 24px' }}>
          <HIDLogo size="md" />
        </div>
        <nav style={{ display:'flex', flexDirection:'column', gap:2, flex:1 }}>
          {navItems.map(item => {
            const active = pathname === item.path || (item.path !== '/app' && pathname.startsWith(item.path))
            return (
              <button key={item.path} onClick={() => nav(item.path)} style={{
                display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
                borderRadius:8, border:'none',
                background: active ? '#e8f1fc' : 'transparent',
                color: active ? '#1a6fd4' : '#374151',
                fontWeight: active ? 600 : 400, fontSize:14,
                textAlign:'left', cursor:'pointer', transition:'all .15s', width:'100%'
              }}>
                <span style={{ opacity: active ? 1 : 0.6 }}>{item.icon}</span>
                {item.label}
              </button>
            )
          })}
        </nav>
        <div style={{ borderTop:'1px solid #e5e7eb', paddingTop:16 }}>
          <div style={{ fontSize:10, color:'#9ca3af', padding:'0 8px', lineHeight:1.7 }}>
            <strong style={{ color:'#6b7280' }}>HID Platform v2.0</strong><br/>
            Health Identity Directory
          </div>
        </div>
      </aside>
      {/* Main */}
      <main style={{ marginLeft:228, flex:1, display:'flex', flexDirection:'column', minHeight:'100vh' }}>
        <div style={{ height:64, background:'#fff', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', padding:'0 32px', justifyContent:'space-between' }}>
          <div>
            <h1 style={{ fontSize:17, fontWeight:700, letterSpacing:'-.3px' }}>{title}</h1>
            {subtitle && <p style={{ fontSize:12, color:'#9ca3af', marginTop:1 }}>{subtitle}</p>}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <a href="/" style={{ fontSize:12, color:'#9ca3af', textDecoration:'none' }}>← Landing page</a>
            <div style={{ width:32, height:32, borderRadius:'50%', background:'#e8f1fc', color:'#1a6fd4', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700 }}>HID</div>
          </div>
        </div>
        <div style={{ flex:1, padding:32, background:'#f3f4f6' }}>{children}</div>
      </main>
    </div>
  )
}
