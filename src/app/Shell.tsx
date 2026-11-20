import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { Close, Menu } from '../components/icons'
import { LAST_PERSONA } from '../state/ResumeContext'

/** The persona you were last working as (remembered by the persona page and the editor). */
function useLastPersona(): { id: string; name: string } | null {
  const { pathname } = useLocation()
  const [p, setP] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    try { setP(JSON.parse(localStorage.getItem(LAST_PERSONA) ?? 'null')) } catch { setP(null) }
  }, [pathname])
  return p
}

function Navbar() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const persona = useLastPersona()
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
          <NavLink to="/" end>Everyone</NavLink>
          {persona && <NavLink to={`/p/${persona.id}`} className="nav-persona"><Avatar id={persona.id} first={persona.name.split(' ')[0] ?? ''} last={persona.name.split(' ')[1] ?? ''} size={22} /> {persona.name}</NavLink>}
          <NavLink to="/editor">Editor</NavLink>
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
        <span className="footer-note">Your CVs are saved on this server. AI only sees what you send it.</span>
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
