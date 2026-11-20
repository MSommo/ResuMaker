import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { acceptInvite, checkInvite } from '../api/client'
import { useAuth } from '../auth/AuthContext'

/** Where an invite or password-reset link lands: /accept#<one-time token>. The token is in the fragment, so it is never sent to a server. */
export default function Accept() {
  const nav = useNavigate()
  const { setMe } = useAuth()
  const [token] = useState(() => window.location.hash.slice(1))
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [email, setEmail] = useState('')
  /** null until the link has been checked; true when the admin didn't know the email and the person must give it. */
  const [needsEmail, setNeedsEmail] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Take the secret out of the address bar and history as soon as we have it.
    if (token) window.history.replaceState(null, '', '/accept')
  }, [token])
  useEffect(() => {
    if (token) checkInvite(token).then((r) => setNeedsEmail(r.needsEmail), () => setNeedsEmail(false)) // an invalid link is reported on submit
  }, [token])

  if (!token)
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>This link doesn’t work</h1>
          <p className="lede">Open the whole link you were sent, or ask for a new one.</p>
        </div>
      </div>
    )

  const mismatch = again !== '' && again !== password
  return (
    <div className="auth-page">
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            setMe(await acceptInvite(token, password, needsEmail ? email : undefined))
            nav('/', { replace: true })
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
            setBusy(false)
          }
        }}
      >
        <span className="brand-mark" aria-hidden>R</span>
        <h1>Complete your account</h1>
        <p className="lede">Your profile was prepared for you. Choose a password (at least 12 characters; a few random words works well) and you’ll be signed in.</p>
        {needsEmail && (
          <div className="field">
            <label htmlFor="em">Your email</label>
            <input id="em" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            <small>This is what you’ll sign in with.</small>
          </div>
        )}
        <div className="field">
          <label htmlFor="pw">New password</label>
          <input id="pw" type="password" autoComplete="new-password" minLength={12} required autoFocus={!needsEmail} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw2">Repeat it</label>
          <input id="pw2" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={mismatch} />
          {mismatch && <small role="alert">The two passwords differ.</small>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn primary large" disabled={busy || needsEmail === null || (needsEmail && !email.trim()) || password.length < 12 || password !== again}>{busy ? 'Saving…' : 'Set password and continue'}</button>
      </form>
    </div>
  )
}
