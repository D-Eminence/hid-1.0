import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { HIDLogo } from '../../components/HIDLogo'
import './Commercial.css'

export function CommercialLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const links = [['Products', '/products'], ['Solutions', '/solutions'], ['Developers', '/developers'], ['Pricing', '/pricing'], ['Company', '/#company']]
  return <div className="commercial-page">
    <header className="commercial-header"><div className="commercial-shell commercial-nav">
      <Link to="/" aria-label="HID home"><HIDLogo size="sm" /></Link>
      <nav className="commercial-links">{links.map(([label, href]) => <Link key={label} to={href}>{label}</Link>)}<a className="commercial-button" href="/hospital/auth">Hospital / Provider Access</a><a className="commercial-button primary" href="mailto:hello@healthidentitydirectory.com?subject=Book a Demo">Book a Demo</a></nav>
      <button className="commercial-button commercial-menu" onClick={() => setOpen(value => !value)} aria-expanded={open}>Menu</button>
    </div>{open && <div className="commercial-shell commercial-mobile">{links.map(([label, href]) => <Link key={label} to={href} onClick={() => setOpen(false)}>{label}</Link>)}<Link to="/patient">Get Your HID</Link><a href="mailto:hello@healthidentitydirectory.com?subject=Book a Demo">Book a Demo</a><a href="/hospital/auth">Hospital / Provider Access</a></div>}</header>
    {children}
    <footer className="commercial-footer"><div className="commercial-shell">HID Technologies · One Health Identity. Connected Care. Accessible Records.</div></footer>
  </div>
}
