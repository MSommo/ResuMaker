import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { Close, Menu } from '../components/icons'
import { useAuth, useMe } from '../auth/AuthContext'

function Navbar() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const me = useMe()
  const { logout } = useAuth()
  const persona = me.persona
  useEffect(() => {
    setOpen(false)
  }, [pathname])
  return (
    <header className="nav no-print">
      <div className="nav-inner">
        <Link to="/" className="brand" aria-label="ResuMaker home">
          <span className="brand-mark" aria-hidden>R</span> ResuMaker
        </Link>
        <button type="button" className="nav-toggle icon-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="nav-links" aria-label="Menu">
          {open ? <Close /> : <Menu />}
        </button>
        <nav id="nav-links" className={`nav-links ${open ? 'open' : ''}`} aria-label="Main">
          <NavLink to="/" end className="nav-persona"><Avatar id={persona.id} first={persona.firstName} last={persona.lastName} size={22} /> My CVs</NavLink>
          <NavLink to="/editor">Editor</NavLink>
          {me.role === 'admin' && <NavLink to="/users">Users</NavLink>}
          <NavLink to="/account">Account</NavLink>
          <button type="button" className="nav-signout" onClick={() => void logout()}>Sign out</button>
        </nav>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="footer no-print">
      <div className="footer-inner">
        <span>© {new Date().getFullYear()} ResuMaker</span>
        <span className="sig">Crafted by <strong>Mario Maraucci</strong></span>
        <span className="footer-note">Your CVs are private to your account. AI only sees what you send it.</span>
      </div>
    </footer>
  )
}

export default function Shell() {
  return (
    <div className="shell">
      <Navbar />
      <main id="main">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
