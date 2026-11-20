import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { Caret, SignOut, User, Users } from '../components/icons'
import { Popover, MenuItem, MenuSep } from '../components/Popover'
import { useAuth, useMe } from '../auth/AuthContext'

/**
 * Brand and the two places you work (your CVs, the editor) on the left; everything about the account behind one avatar
 * button on the right. Small enough for a phone without a hamburger menu.
 */
function Navbar() {
  const me = useMe()
  const { logout } = useAuth()
  const go = useNavigate()
  const p = me.persona
  const name = `${p.firstName} ${p.lastName}`.trim() || me.login
  return (
    <header className="nav no-print">
      <div className="nav-inner">
        <Link to="/" className="brand" aria-label="ResuMaker home">
          <span className="brand-mark" aria-hidden>R</span> <span className="brand-name">ResuMaker</span>
        </Link>
        <nav className="nav-links" aria-label="Main">
          <NavLink to="/" end>My CVs</NavLink>
          <NavLink to="/editor">Editor</NavLink>
        </nav>
        <Popover
          label="Account menu"
          role="menu"
          align="right"
          className="menu-pop nav-menu"
          triggerClassName="nav-me"
          trigger={<><Avatar id={p.id} first={p.firstName} last={p.lastName} size={28} /><span className="nav-me-name">{p.firstName || 'Account'}</span><Caret className="nav-me-caret" /></>}
        >
          {() => (
            <>
              <div className="nav-menu-who">
                <Avatar id={p.id} first={p.firstName} last={p.lastName} size={36} />
                <span><strong>{name}</strong><small>{me.login}</small></span>
              </div>
              <MenuSep />
              <MenuItem icon={<User />} onSelect={() => go('/account')}>Account</MenuItem>
              {me.role === 'admin' && <MenuItem icon={<Users />} onSelect={() => go('/users')}>Users <span className="badge">Admin</span></MenuItem>}
              <MenuSep />
              <MenuItem icon={<SignOut />} onSelect={() => void logout()}>Sign out</MenuItem>
            </>
          )}
        </Popover>
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
