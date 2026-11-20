import { useState } from 'react'
import { signIn } from '../api/client'
import { useAuth } from '../auth/AuthContext'

/** Sign in. The server answers every failure the same way, so this page can't reveal which emails have accounts. */
export default function Login() {
  const { setMe } = useAuth()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <div className="auth-page">
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            setMe(await signIn(login, password))
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
            setPassword('')
            setBusy(false)
          }
        }}
      >
        <span className="brand-mark" aria-hidden>R</span>
        <h1>Sign in to ResuMaker</h1>
        <p className="lede">Your CVs are private to your account.</p>
        <div className="field">
          <label htmlFor="login">Email</label>
          <input id="login" type="email" autoComplete="username" required autoFocus value={login} onChange={(e) => setLogin(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn primary large" disabled={busy || !login || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="auth-note">No account yet, or forgot your password? Ask the person who runs this ResuMaker for a link.</p>
      </form>
    </div>
  )
}
