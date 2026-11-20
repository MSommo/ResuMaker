import { useState } from 'react'
import { Link } from 'react-router-dom'
import { changePassword, deleteAccount, signOutEverywhere } from '../api/client'
import { useAuth, useMe } from '../auth/AuthContext'
import { Back } from '../components/icons'
import { PasswordConfirm } from '../components/PasswordConfirm'

export default function Account() {
  const me = useMe()
  const { logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  return (
    <div className="container narrow page">
      <Link to="/" className="back"><Back /> My CVs</Link>
      <h1>Account</h1>
      <p className="lede">Signed in as <strong>{me.login}</strong>{me.role === 'admin' ? ' · administrator' : ''}.</p>

      <section className="panelbox" aria-labelledby="pw-h">
        <h2 id="pw-h">Change password</h2>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setMsg(null)
            try {
              await changePassword(current, next)
              setCurrent(''); setNext(''); setAgain('')
              setMsg({ ok: true, text: 'Password changed. Your other devices were signed out.' })
            } catch (err) {
              setMsg({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong.' })
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="field"><label htmlFor="cur">Current password</label><input id="cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
          <div className="field"><label htmlFor="new">New password</label><input id="new" type="password" autoComplete="new-password" minLength={12} required value={next} onChange={(e) => setNext(e.target.value)} /><small>At least 12 characters.</small></div>
          <div className="field"><label htmlFor="again">Repeat it</label><input id="again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} /></div>
          {msg && <p className={msg.ok ? 'notice' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
          <div className="form-actions"><button type="submit" className="btn primary" disabled={busy || next.length < 12 || next !== again || !current}>{busy ? 'Saving…' : 'Change password'}</button></div>
        </form>
      </section>

      <section className="panelbox" aria-labelledby="dev-h">
        <h2 id="dev-h">Devices</h2>
        <p className="lede">Sign out everywhere else if you used a computer that isn’t yours.</p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => void signOutEverywhere().then(() => setMsg({ ok: true, text: 'Every other device was signed out.' }))}>Sign out other devices</button>
          <button type="button" className="btn" onClick={() => void logout()}>Sign out</button>
        </div>
      </section>

      <section className="panelbox danger-zone" aria-labelledby="del-h">
        <h2 id="del-h">Delete my account</h2>
        <p className="lede">Permanently deletes your profile, every CV, the version history and what the assistant remembers. This can’t be undone.</p>
        {deleting ? (
          <PasswordConfirm label="Delete everything" onCancel={() => setDeleting(false)} onConfirm={async (pw) => { await deleteAccount(pw); await logout() }} />
        ) : (
          <button type="button" className="btn danger" onClick={() => setDeleting(true)}>Delete my account…</button>
        )}
      </section>
    </div>
  )
}
