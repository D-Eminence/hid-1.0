import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { HIDLogo } from './HIDLogo'
import { PatientNotificationWatcher } from './PatientNotificationWatcher'
import { countUnreadNotifications } from '../lib/hidApi'
import { getPersonInitials } from '../lib/utils'
import { preloadPath } from '../lib/routePreload'
import { subscribeToNotifications } from '../lib/notificationsRealtime'

interface NavItem {
  path: string
  label: string
}

function BellBadge({ hasUnread, onClick }: { hasUnread: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{ position: 'relative', width: 42, height: 42, borderRadius: 999, border: '1px solid #eef1f5', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', cursor: onClick ? 'pointer' : 'default' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M12 4a4 4 0 0 0-4 4v2.1c0 .7-.2 1.4-.6 2L6 14.5h12l-1.4-2.4c-.4-.6-.6-1.3-.6-2V8a4 4 0 0 0-4-4Z" stroke="#111827" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 18a2 2 0 0 0 4 0" stroke="#111827" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {hasUnread && <span style={{ position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: '50%', background: '#9b1128', boxShadow: '0 0 0 2px #fff' }} />}
    </button>
  )
}

function ProfilePill({
  initials,
  photoUrl,
  open,
  onClick,
}: {
  initials: string
  photoUrl?: string | null
  open: boolean
  onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{ height: 42, padding: '0 12px', borderRadius: 999, border: '1px solid #eef1f5', display: 'inline-flex', alignItems: 'center', gap: 10, background: '#fff', cursor: 'pointer' }}>
      {photoUrl ? (
        <img src={photoUrl} alt="Profile" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
      ) : (
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#f0f7ff', color: '#1f8cff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
          {initials}
        </span>
      )}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d={open ? 'M2 6.5 5 3.5 8 6.5' : 'M2 3.5 5 6.5 8 3.5'} stroke="#9aa6b2" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

export function PortalShell({
  title,
  subtitle,
  items,
  onLogout,
  userName,
  avatarInitials,
  avatarUrl,
  notificationPath,
  notificationHidCode,
  onAvatarUpload,
  children,
}: {
  title: string
  subtitle?: string
  items: NavItem[]
  onLogout: () => void
  userName?: string
  avatarInitials?: string
  avatarUrl?: string | null
  notificationPath?: string
  notificationHidCode?: string
  onAvatarUpload?: (file: File) => void
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const menuRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const initials = useMemo(() => {
    if (avatarInitials?.trim()) return avatarInitials.trim().slice(0, 2).toUpperCase()
    return getPersonInitials(userName?.trim() || title)
  }, [avatarInitials, title, userName])
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false)

  useEffect(() => {
    if (!notificationPath) return
    let active = true

    async function loadUnread() {
      try {
        const count = await countUnreadNotifications()
        if (!active) return
        setHasUnreadNotifications(count > 0)
      } catch {
        if (!active) return
        setHasUnreadNotifications(false)
      }
    }

    void loadUnread()
    const unsubscribe = subscribeToNotifications(() => {
      void loadUnread()
    })
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadUnread()
      }
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadUnread()
      }
    }, 45000)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      active = false
      unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.clearInterval(interval)
    }
  }, [notificationPath])

  useEffect(() => {
    const paths = Array.from(new Set([...items.map(item => item.path), ...(notificationPath ? [notificationPath] : [])]))
    const timer = window.setTimeout(() => {
      paths.forEach(path => preloadPath(path))
    }, 20)
    return () => window.clearTimeout(timer)
  }, [items, notificationPath])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', padding: '22px clamp(12px, 2vw, 24px)' }}>
      <div style={{ maxWidth: 1360, margin: '0 auto', background: '#fff', borderRadius: 28, border: '1px solid #eef1f5', minHeight: 'calc(100vh - 44px)', padding: '36px clamp(18px, 3vw, 46px)', boxShadow: '0 18px 38px rgba(15, 23, 42, 0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => preloadPath(items[0]?.path ?? '/')}
            onClick={() => navigate(items[0]?.path ?? '/')}
          >
            <HIDLogo size="sm" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
            <div onMouseEnter={() => { if (notificationPath) preloadPath(notificationPath) }}>
              <BellBadge hasUnread={hasUnreadNotifications} onClick={notificationPath ? () => navigate(notificationPath) : undefined} />
            </div>
            <div style={{ position: 'relative' }} ref={menuRef}>
              <ProfilePill initials={initials} photoUrl={avatarUrl} open={profileMenuOpen} onClick={() => setProfileMenuOpen(value => !value)} />
              {profileMenuOpen && (
                <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 190, borderRadius: 16, background: '#fff', border: '1px solid #eef1f5', boxShadow: '0 18px 34px rgba(15, 23, 42, 0.12)', padding: 8, zIndex: 20 }}>
                  {onAvatarUpload && (
                    <>
                      <button onClick={() => fileInputRef.current?.click()} style={{ width: '100%', border: 'none', background: '#fff', textAlign: 'left', borderRadius: 12, padding: '10px 12px', color: '#111827', cursor: 'pointer' }}>
                        Upload profile photo
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".img,.png,.jpg,.jpeg,image/png,image/jpeg"
                        style={{ display: 'none' }}
                        onChange={event => {
                          const file = event.target.files?.[0]
                          if (file) onAvatarUpload(file)
                          event.currentTarget.value = ''
                          setProfileMenuOpen(false)
                        }}
                      />
                    </>
                  )}
                  <button onClick={onLogout} style={{ width: '100%', border: 'none', background: '#fff5f5', textAlign: 'left', borderRadius: 12, padding: '10px 12px', color: '#b91c1c', cursor: 'pointer', fontWeight: 600 }}>
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginTop: 26, paddingBottom: 14, borderBottom: '1px solid #edf1f5', flexWrap: 'wrap' }}>
          <nav style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            {items.map((item, index) => {
              const active = location.pathname === item.path
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  onMouseEnter={() => preloadPath(item.path)}
                  onFocus={() => preloadPath(item.path)}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: active ? '#111827' : '#9aa6b2',
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    padding: '6px 0',
                    borderBottom: active ? '2px solid #111827' : '2px solid transparent',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>

        </div>

        <div style={{ marginTop: 28 }}>
          {notificationHidCode ? <PatientNotificationWatcher hidCode={notificationHidCode} /> : null}
          {(title || subtitle) && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#111827', letterSpacing: '-0.03em' }}>{title}</div>
              {subtitle && <div style={{ marginTop: 6, color: '#8a95a6', fontSize: 13 }}>{subtitle}</div>}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
