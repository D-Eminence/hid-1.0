import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import folderPreviewImage from '../../lp/B.png'
import { HIDLogo } from '../components/HIDLogo'
import { LegalDocumentsModal } from '../components/LegalDocumentsModal'
import { HOSPITAL_AUTH_PATH } from '../lib/hospitalRoutes'
import { preloadRoute, preloadRoutesAfterDelay } from '../lib/routePreload'

type FooterLink = {
  label: string
  href?: string
  onClick?: () => void
}

type SecurityCardKind =
  | 'controlled-access'
  | 'consent-sharing'
  | 'secure-cloud'
  | 'encryption'
  | 'verified-identity'
  | 'compliance'

const sectionPadding = '80px clamp(20px, 5vw, 48px)'

const footerLinkStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: '#6b7280',
  marginBottom: 10,
  background: 'none',
  border: 'none',
  padding: 0,
  textAlign: 'left',
  cursor: 'pointer',
}

function FooterLinkItem({ link }: { link: FooterLink }) {
  if (link.onClick) {
    return (
      <button type="button" onClick={link.onClick} style={footerLinkStyle}>
        {link.label}
      </button>
    )
  }

  return (
    <a href={link.href} style={footerLinkStyle}>
      {link.label}
    </a>
  )
}

function SocialIconLink({
  href,
  label,
  children,
}: {
  href: string
  label: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        border: '1px solid #d7deea',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#4b5563',
        transition: 'all 0.2s ease',
        background: '#fff',
      }}
      onMouseEnter={event => {
        event.currentTarget.style.color = '#1a6fd4'
        event.currentTarget.style.borderColor = '#1a6fd4'
      }}
      onMouseLeave={event => {
        event.currentTarget.style.color = '#4b5563'
        event.currentTarget.style.borderColor = '#d7deea'
      }}
    >
      {children}
    </a>
  )
}

function SecurityCardIcon({
  kind,
}: {
  kind: SecurityCardKind
}) {
  if (kind === 'controlled-access') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 10V7.5A4 4 0 0 1 12 3.5A4 4 0 0 1 16 7.5V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="14.5" r="1.2" fill="currentColor" />
      </svg>
    )
  }

  if (kind === 'consent-sharing') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7.5 13.5L4.5 10.5A2.5 2.5 0 1 1 8 7l1.5 1.5L11 10l1.5-1.5L14 7a2.5 2.5 0 1 1 3.5 3.5l-5.5 5.5-2.5-2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 14h6M16 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }

  if (kind === 'secure-cloud') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7.5 18.5h9a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 6.45 9.2A3.8 3.8 0 0 0 7.5 18.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 10.5v7M9.5 15l2.5 2.5L14.5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  if (kind === 'encryption') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3.5L5.5 6v5.8c0 4.1 2.6 7.8 6.5 8.9c3.9-1.1 6.5-4.8 6.5-8.9V6L12 3.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9.5 12.5l1.7 1.7l3.3-3.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  if (kind === 'verified-identity') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M6.5 18.5a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M17 9.5l1.4 1.4L21 8.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5L5.5 6v5.8c0 4.1 2.6 7.8 6.5 8.9c3.9-1.1 6.5-4.8 6.5-8.9V6L12 3.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 11.8l2 2l4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 16.5h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export default function Landing() {
  const navigate = useNavigate()
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [legalOpen, setLegalOpen] = useState(false)

  const faqs = [
    { q: 'What is HID?', a: 'HID (Health Identity Directory) is a unified digital health identity platform that gives every patient a single, secure ID linking their complete medical history and making it available at any hospital, anytime.' },
    { q: 'How do I create my HID?', a: 'Sign up with your first name, last name, email address, phone number, and gender. Create your password and your HID code is generated for your record.' },
    { q: 'Is my data safe?', a: 'Yes. All data is encrypted end-to-end, stored on secure cloud infrastructure, and designed around healthcare privacy expectations.' },
    { q: 'Can hospitals outside my city access my HID?', a: 'Yes. Any hospital in the HID network can access records using your HID number, ensuring continuity of care anywhere.' },
    { q: 'Do I need an account to use HID?', a: 'Yes. Patients sign in with their HID code and password, while hospitals create an organization account and sign in from the hospital portal with hospital name, email, and password.' },
  ]
  const securityCards: Array<{ icon: SecurityCardKind; title: string; desc: string }> = [
    { icon: 'controlled-access', title: 'Controlled Access', desc: 'Only verified medical professionals can access or update a patient health information.' },
    { icon: 'consent-sharing', title: 'Consent-Based Sharing', desc: 'Patients approve when and where their data can be accessed, keeping control in the right hands.' },
    { icon: 'secure-cloud', title: 'Secure Cloud Infrastructure', desc: 'Reliable, monitored, redundant systems that ensure uptime, stability, and continuous protection.' },
    { icon: 'encryption', title: 'End-to-End Encryption', desc: 'Records are encrypted at rest and in transit, unreadable to anyone except authorized hospitals.' },
    { icon: 'verified-identity', title: 'Verified Identity Protection', desc: 'Each HID is linked to a unique patient record, reducing duplicates, fraud, and identity mix-ups.' },
    { icon: 'compliance', title: 'Compliance Standards', desc: 'Built with healthcare privacy and auditability in mind.' },
  ]

  const footerGroups: Array<{ head: string; links: FooterLink[] }> = [
    {
      head: 'Product',
      links: [
        { label: 'How HID Works', href: '#how-it-works' },
        { label: 'Features', href: '#features' },
        { label: 'Security & Compliance', href: '#security' },
      ],
    },
    {
      head: 'Access',
      links: [
        { label: 'Patient Portal', onClick: () => navigate('/patient') },
        { label: 'Hospital Portal', onClick: () => navigate(HOSPITAL_AUTH_PATH) },
        { label: 'FAQs', href: '#faq' },
      ],
    },
    {
      head: 'Legal',
      links: [
        { label: 'Privacy Policy', onClick: () => setLegalOpen(true) },
        { label: 'Terms of Service', onClick: () => setLegalOpen(true) },
      ],
    },
  ]

  useEffect(() => preloadRoutesAfterDelay(['patientAuth', 'doctorAuth']), [])

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", color: '#111827', background: '#fff' }}>
      <nav
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px clamp(16px, 4vw, 48px)',
          minHeight: 64,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <HIDLogo size="sm" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(16px, 4vw, 32px)', flexWrap: 'wrap', justifyContent: 'center' }}>
          {['How it Works', 'Features', 'Security'].map(link => (
            <a
              key={link}
              href={`#${link.toLowerCase().replace(/ /g, '-')}`}
              style={{ fontSize: 14, fontWeight: 500, color: '#6b7280', transition: 'color 0.15s' }}
              onMouseEnter={event => {
                event.currentTarget.style.color = '#111827'
              }}
              onMouseLeave={event => {
                event.currentTarget.style.color = '#6b7280'
              }}
            >
              {link}
            </a>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate('/patient')}
            onMouseEnter={() => preloadRoute('patientAuth')}
            onFocus={() => preloadRoute('patientAuth')}
            style={{
              background: '#1a6fd4',
              color: 'white',
              border: 'none',
              borderRadius: 999,
              padding: '9px 22px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Patient
          </button>
          <button
            onClick={() => navigate(HOSPITAL_AUTH_PATH)}
            onMouseEnter={() => preloadRoute('doctorAuth')}
            onFocus={() => preloadRoute('doctorAuth')}
            style={{
              background: '#1a6fd4',
              color: '#fff',
              border: 'none',
              borderRadius: 999,
              padding: '9px 22px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Hospital
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '72px clamp(20px, 5vw, 24px) 80px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 24,
            padding: '48px clamp(20px, 5vw, 40px) 36px',
            width: '100%',
            maxWidth: 580,
            boxShadow: '0 4px 32px rgba(0,0,0,0.06)',
          }}
        >
          <h1 style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.8px', marginBottom: 14 }}>
            One Patient. <span style={{ color: '#1a6fd4' }}>One ID</span>.<br />Your Health, Anywhere.
          </h1>
          <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7, marginBottom: 28, maxWidth: 360, margin: '0 auto 28px' }}>
            HID gives every patient a secure, unified health identity so complete medical history is available at any hospital, anywhere, anytime.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 18 }}>
            {[
              { title: 'Patient', path: '/patient' },
              { title: 'Hospital', path: HOSPITAL_AUTH_PATH },
            ].map(portal => (
              <button
                key={portal.title}
                onClick={() => navigate(portal.path)}
                onMouseEnter={() => preloadRoute(portal.path === '/patient' ? 'patientAuth' : 'doctorAuth')}
                onFocus={() => preloadRoute(portal.path === '/patient' ? 'patientAuth' : 'doctorAuth')}
                style={{
                  textAlign: 'center',
                  border: 'none',
                  borderRadius: 999,
                  background: '#1a6fd4',
                  color: '#fff',
                  padding: '14px 16px',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 15,
                }}
              >
                {portal.title}
              </button>
            ))}
          </div>

          <div style={{ background: '#f3f4f6', borderRadius: 14, padding: 'clamp(16px, 4vw, 24px)', marginTop: 28, width: '100%' }}>
            <img
              src={folderPreviewImage}
              alt="HID patient folder preview"
              style={{ display: 'block', width: '100%', maxWidth: 420, height: 'auto', margin: '0 auto' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            {['HIPAA + NDPR aligned', 'Secure Cloud Infrastructure'].map(text => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280' }}>
                <div style={{ width: 16, height: 16, background: '#1a6fd4', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                    <path d="M1.5 4.5l2 2L7.5 2" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                {text}
              </div>
            ))}
          </div>
        </div>
      </div>

      <section id="features" style={{ padding: sectionPadding, background: '#fff', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px' }}>
            <span style={{ color: '#1a6fd4' }}>Built With Purpose:</span> The Features Behind HID
          </h2>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 10, lineHeight: 1.7, maxWidth: 520, margin: '10px auto 0' }}>
            HID brings patients, hospitals, and administrators onto one secure platform. Centralizing records, simplifying care, and ensuring every decision is informed and connected.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {[
            { tag: 'Patient Features', title: 'Your Entire Health Story, In One Secure Place', desc: 'A simple, unified patient profile stores medical history, prescriptions, lab results, and emergencies, so the right information is available when it matters.', flip: false },
            { tag: 'Hospital Features', title: 'Hospital & Medical Staff Features', desc: 'Hospitals can retrieve verified patient records in seconds, update files in real time, and deliver faster, safer care without duplicate tests or missing details.', flip: true },
          ].map(({ tag, title, desc, flip }) => (
            <div
              key={tag}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 20,
                overflow: 'hidden',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                direction: flip ? 'rtl' : 'ltr',
              }}
            >
              <div style={{ background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, minHeight: 220, direction: 'ltr' }}>
                <svg width="160" height="140" viewBox="0 0 160 140" fill="none">
                  {flip ? (
                    <>
                      <rect x="20" y="20" width="90" height="100" rx="4" fill="#dbeafe" stroke="#bfdbfe" strokeWidth="1.5" />
                      <rect x="30" y="10" width="70" height="16" rx="3" fill="#93c5fd" />
                      <rect x="48" y="20" width="18" height="5" rx="2.5" fill="white" />
                      <rect x="55" y="14" width="6" height="17" rx="3" fill="white" />
                      {[36, 52, 68, 84].map((y, index) => (
                        <rect key={index} x="30" y={y} width={[40, 28, 32, 40][index]} height="6" rx="3" fill="white" opacity="0.7" />
                      ))}
                      <rect x="90" y="68" width="58" height="44" rx="6" fill="white" stroke="#bfdbfe" strokeWidth="1" />
                      <rect x="99" y="78" width="32" height="5" rx="2.5" fill="#bfdbfe" />
                      <rect x="99" y="88" width="24" height="5" rx="2.5" fill="#dbeafe" />
                      <rect x="99" y="98" width="28" height="5" rx="2.5" fill="#dbeafe" />
                      <text x="120" y="77" textAnchor="middle" fontSize="6" fill="#1a6fd4" fontFamily="Inter,sans-serif">Patient Info</text>
                    </>
                  ) : (
                    <>
                      <rect x="15" y="18" width="100" height="104" rx="8" fill="#e8f1fc" stroke="#bfdbfe" strokeWidth="1.5" />
                      <rect x="50" y="10" width="30" height="14" rx="5" fill="#93c5fd" />
                      <rect x="56" y="12" width="18" height="10" rx="3" fill="#1a6fd4" />
                      <rect x="28" y="38" width="74" height="6" rx="3" fill="#bfdbfe" />
                      {[50, 62, 74, 86].map((y, index) => (
                        <rect key={index} x="28" y={y} width={[58, 44, 52, 36][index]} height="6" rx="3" fill="#dbeafe" />
                      ))}
                      <circle cx="122" cy="50" r="20" fill="#1a6fd4" />
                      <path d="M115 50h14M122 43v14" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                    </>
                  )}
                </svg>
              </div>
              <div style={{ padding: '40px 36px', display: 'flex', flexDirection: 'column', justifyContent: 'center', direction: 'ltr' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', background: '#e8f1fc', color: '#1a6fd4', fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 999, marginBottom: 14, width: 'fit-content' }}>{tag}</span>
                <h3 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 12 }}>{title}</h3>
                <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7 }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" style={{ padding: sectionPadding, background: '#f8f9fb' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px' }}>How HID Works</h2>
            <p style={{ fontSize: 14, color: '#6b7280', marginTop: 10, lineHeight: 1.7 }}>Four steps that show exactly how HID connects you and your hospital without stress or paperwork.</p>
          </div>
          {[
            { n: '01', title: 'Create Your HID Profile', desc: 'Patient sign up creates the account and issues a unique Health ID for future lookups and updates.' },
            { n: '02', title: 'Link Your Health Records', desc: 'Hospitals upload or sync medical history. Lab results, prescriptions, and visit notes are attached to the HID profile.' },
            { n: '03', title: 'Access Anywhere', desc: 'Patients use their HID at any hospital. Records are instantly accessible to medical staff across the country.' },
            { n: '04', title: 'Hospital Pulls Your Data', desc: 'Hospital staff retrieve the complete patient file instantly. No paperwork, no delays, and no duplicate onboarding flow.' },
          ].map(({ n, title, desc }, index) => (
            <div
              key={n}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 20,
                overflow: 'hidden',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                marginBottom: 20,
                background: '#fff',
                direction: index % 2 === 1 ? 'rtl' : 'ltr',
              }}
            >
              <div style={{ background: '#e8f1fc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, minHeight: 160, position: 'relative', direction: 'ltr' }}>
                <span style={{ position: 'absolute', top: 16, left: 20, fontSize: 48, fontWeight: 800, color: 'rgba(26,111,212,0.12)', lineHeight: 1 }}>{n}</span>
                <div style={{ width: 80, height: 56, background: 'white', borderRadius: 10, border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="48" height="36" viewBox="0 0 48 36" fill="none">
                    <rect x="2" y="2" width="44" height="32" rx="4" fill="#f3f4f6" stroke="#e5e7eb" strokeWidth="1" />
                    <rect x="8" y="8" width="20" height="4" rx="2" fill="#bfdbfe" />
                    <rect x="8" y="15" width="32" height="3" rx="1.5" fill="#dbeafe" />
                    <rect x="8" y="21" width="24" height="3" rx="1.5" fill="#dbeafe" />
                    <rect x="30" y="24" width="14" height="6" rx="3" fill="#1a6fd4" />
                    <text x="37" y="29" textAnchor="middle" fontSize="4" fill="white" fontFamily="Inter,sans-serif">Go</text>
                  </svg>
                </div>
              </div>
              <div style={{ padding: '36px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'center', direction: 'ltr' }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{title}</h3>
                <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7 }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="security" style={{ padding: sectionPadding, background: '#fff' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 36, flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px', maxWidth: 420 }}>Security & Compliance</h2>
              <p style={{ fontSize: 14, color: '#6b7280', marginTop: 10, maxWidth: 380, lineHeight: 1.7 }}>
                HID is built with enterprise-level protection, strict privacy controls, and global healthcare compliance ensuring every patient record stays secure, encrypted, and fully under patient&apos;s control.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => navigate('/patient')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#1a6fd4', background: 'none', border: 'none', cursor: 'pointer' }}>
                Patient Portal <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button onClick={() => navigate(HOSPITAL_AUTH_PATH)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#15803d', background: 'none', border: 'none', cursor: 'pointer' }}>
                Hospital Portal <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 }}>
            {securityCards.map(({ icon, title, desc }) => (
              <div key={title} style={{ border: '1px solid #e5e7eb', borderRadius: 14, padding: '24px 20px' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: '#e8f1fc', color: '#1a6fd4', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <SecurityCardIcon kind={icon} />
                </div>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{title}</h4>
                <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div style={{ background: 'linear-gradient(135deg, #1a6fd4 0%, #1254a8 100%)', padding: '80px clamp(20px, 5vw, 48px)', textAlign: 'center' }}>
        <h2 style={{ fontSize: 32, fontWeight: 800, color: 'white', letterSpacing: '-0.6px', lineHeight: 1.2, marginBottom: 16, maxWidth: 560, margin: '0 auto 16px' }}>
          Get Your HID Today and Take Control of Your Health Records
        </h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', marginBottom: 28, maxWidth: 440, margin: '0 auto 28px', lineHeight: 1.7 }}>
          Patients can manage profile and health records, while hospitals can request access and add medical records.
        </p>
        <div style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            onClick={() => navigate('/patient')}
            onMouseEnter={() => preloadRoute('patientAuth')}
            onFocus={() => preloadRoute('patientAuth')}
            style={{
              background: '#1a6fd4',
              color: '#fff',
              border: 'none',
              borderRadius: 999,
              padding: '13px 32px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            Patient
          </button>
          <button
            onClick={() => navigate(HOSPITAL_AUTH_PATH)}
            onMouseEnter={() => preloadRoute('doctorAuth')}
            onFocus={() => preloadRoute('doctorAuth')}
            style={{
              background: '#1a6fd4',
              color: '#fff',
              border: 'none',
              borderRadius: 999,
              padding: '13px 32px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            Hospital
          </button>
        </div>
      </div>

      <section id="faq" style={{ padding: sectionPadding, background: '#fff' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 32 }}>
          <div>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 12 }}>FAQ</h2>
            <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7 }}>Everything you need to know about HID from setup to security and accessing your health records anywhere.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {faqs.map(({ q, a }, index) => (
              <div key={index} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <button
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '20px 0',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    gap: 16,
                    fontFamily: 'inherit',
                    fontSize: 14,
                    fontWeight: 500,
                    color: '#111827',
                  }}
                >
                  {q}
                  <span style={{ width: 22, height: 22, borderRadius: '50%', border: '1.5px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#6b7280', transition: 'all 0.2s', background: openFaq === index ? '#1a6fd4' : 'transparent', borderColor: openFaq === index ? '#1a6fd4' : '#e5e7eb' }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: openFaq === index ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>
                      <path d="M5 2v6M2 5h6" stroke={openFaq === index ? 'white' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </span>
                </button>
                {openFaq === index && <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7, paddingBottom: 20 }}>{a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer style={{ background: '#f8f9fb', padding: '56px clamp(20px, 5vw, 48px) 0' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 32, paddingBottom: 40, borderBottom: '1px solid #e5e7eb' }}>
            <div>
              <HIDLogo size="sm" />
              <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.7, marginTop: 14, maxWidth: 260 }}>
                HID is a unified digital health identity that lets patients and hospitals securely access verified medical records anytime, anywhere.
              </p>
              <div style={{ display: 'grid', gap: 6, marginTop: 14 }}>
                <a href="mailto:support@healthidentitydirectory.com" style={{ fontSize: 13, color: '#6b7280' }}>support@healthidentitydirectory.com</a>
                <a href="tel:+2347026717252" style={{ fontSize: 13, color: '#6b7280' }}>+2347026717252</a>
              </div>
            </div>
            {footerGroups.map(({ head, links }) => (
              <div key={head}>
                <h5 style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>{head}</h5>
                {links.map(link => (
                  <FooterLinkItem key={link.label} link={link} />
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 0', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <SocialIconLink href="https://www.instagram.com/hidirectoryhq" label="Instagram">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="1.8" />
                  <circle cx="12" cy="12" r="4.1" stroke="currentColor" strokeWidth="1.8" />
                  <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" />
                </svg>
              </SocialIconLink>
              <SocialIconLink href="https://x.com/hidirectoryhq" label="X">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 4h4.2l4.1 5.6L17.1 4H20l-6.4 7.2L20 20h-4.2l-4.4-6L6.1 20H4l6.5-7.4L4 4z" fill="currentColor" />
                </svg>
              </SocialIconLink>
              <SocialIconLink href="https://www.linkedin.com/company/hid-health-ng/" label="LinkedIn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6.4 9.2V19" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  <path d="M11 19V9.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  <path d="M11 12.4c0-1.8 1.5-3.2 3.3-3.2 1.9 0 3.3 1.4 3.3 3.8V19" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="6.4" cy="5.8" r="1.4" fill="currentColor" />
                </svg>
              </SocialIconLink>
              <SocialIconLink href="https://vm.tiktok.com/ZS98v2n48uHRt-ua2WD/" label="TikTok">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M14.2 4.5c.8 1.8 2.1 3 3.8 3.4v2.8c-1.4 0-2.7-.4-3.8-1.2v4.7a4.8 4.8 0 1 1-4.8-4.8c.4 0 .8.1 1.2.2v3c-.4-.2-.8-.3-1.2-.3a1.9 1.9 0 1 0 1.9 1.9V4.5h2.9z" fill="currentColor" />
                </svg>
              </SocialIconLink>
              <SocialIconLink href="https://www.facebook.com/share/14ZGb6gZXUR/" label="Facebook">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M13.6 20v-7h2.4l.4-2.8h-2.8V8.4c0-.8.2-1.4 1.4-1.4H16V4.5c-.2 0-.9-.1-1.7-.1-2.6 0-4.2 1.5-4.2 4.4v1.4H7.8V13H10v7h3.6z" fill="currentColor" />
                </svg>
              </SocialIconLink>
            </div>
            <p style={{ fontSize: 12, color: '#9ca3af' }}>Copyright 2025 HID Technologies. All rights reserved.</p>
          </div>
        </div>
        <div style={{ textAlign: 'center', padding: '24px 0 32px', fontSize: 'clamp(28px, 6vw, 64px)', fontWeight: 800, color: 'rgba(26,111,212,0.08)', letterSpacing: '-1px', userSelect: 'none', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          HEALTH IDENTITY DIRECTORY
        </div>
      </footer>
      <LegalDocumentsModal open={legalOpen} onClose={() => setLegalOpen(false)} />
    </div>
  )
}
