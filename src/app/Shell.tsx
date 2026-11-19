import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Close, Menu } from '../components/icons'

function Navbar() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])
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
          <NavLink to="/" end>Layouts</NavLink>
          <NavLink to="/editor">Editor</NavLink>
          <NavLink to="/preview">Preview</NavLink>
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
        <span className="footer-note">Your data never leaves this browser.</span>
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
