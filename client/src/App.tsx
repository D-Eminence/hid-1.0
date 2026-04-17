import React, { Component, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import RegisterPatient from './pages/RegisterPatient'
import DoctorAccess from './pages/DoctorAccess'
import MedicalRecords from './pages/MedicalRecords'
import AccessLogs from './pages/AccessLogs'
import { ToastProvider } from './components/ui'
import { isConfigured } from './lib/supabase'
import { initAnalytics } from './lib/analytics'

class ErrorBoundary extends Component<{children:React.ReactNode},{error:Error|null}> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e } }
  render() {
    if (this.state.error) return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:32, background:'#f3f4f6' }}>
        <div style={{ background:'#fff', borderRadius:16, padding:40, maxWidth:520, width:'100%', border:'1px solid #e5e7eb', textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:16 }}>⚠️</div>
          <h2 style={{ fontWeight:700, marginBottom:8 }}>Something went wrong</h2>
          <p style={{ color:'#6b7280', fontSize:14, marginBottom:20 }}>{(this.state.error as Error).message}</p>
          <button onClick={() => window.location.reload()} style={{ background:'#1a6fd4', color:'#fff', border:'none', borderRadius:8, padding:'10px 24px', fontWeight:600, cursor:'pointer' }}>Reload</button>
        </div>
      </div>
    )
    return this.props.children
  }
}

function SetupBanner() {
  if (isConfigured) return null
  return (
    <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:9999, background:'#1e3a5f', color:'#fff', padding:'14px 24px', display:'flex', alignItems:'center', gap:16, fontSize:13 }}>
      <span>🔧</span>
      <div style={{ flex:1 }}>
        <strong>Supabase not connected.</strong> Add <code style={{ background:'rgba(255,255,255,.15)', padding:'1px 6px', borderRadius:4 }}>VITE_SUPABASE_URL</code> and <code style={{ background:'rgba(255,255,255,.15)', padding:'1px 6px', borderRadius:4 }}>VITE_SUPABASE_ANON_KEY</code> to your <code style={{ background:'rgba(255,255,255,.15)', padding:'1px 6px', borderRadius:4 }}>.env</code> file.
      </div>
      <a href="https://supabase.com" target="_blank" rel="noreferrer" style={{ background:'#1a6fd4', color:'#fff', padding:'7px 16px', borderRadius:8, fontWeight:600, textDecoration:'none', whiteSpace:'nowrap' }}>Get Keys →</a>
    </div>
  )
}

function Analytics() {
  useEffect(() => { initAnalytics() }, [])
  return null
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Analytics />
        <ToastProvider />
        <SetupBanner />
        <Routes>
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/register" element={<RegisterPatient />} />
          <Route path="/app/doctor" element={<DoctorAccess />} />
          <Route path="/app/records" element={<MedicalRecords />} />
          <Route path="/app/logs" element={<AccessLogs />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
