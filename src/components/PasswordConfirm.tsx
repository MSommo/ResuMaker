import { useState } from 'react'

/** Inline "type your password to confirm" for destructive actions. */
export function PasswordConfirm({ label, onConfirm, onCancel }: { label: string; onConfirm: (password: string) => Promise<void>; onCancel: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <form
      className="confirm-inline"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        try {
          await onConfirm(password)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Something went wrong.')
          setBusy(false)
        }
      }}
    >
      <label>
        <span>Enter your password to confirm</span>
        <input type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button type="submit" className="btn small danger" disabled={busy || !password}>{busy ? 'Working…' : label}</button>
      <button type="button" className="btn small" onClick={onCancel} disabled={busy}>Cancel</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  )
}
