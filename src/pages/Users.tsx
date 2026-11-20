import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createDraft, deleteUser, listUsers, patchUser, reissueInvite, signUserOut, type AdminUser, type Invite, type Role } from '../api/client'
import { useMe } from '../auth/AuthContext'
import { Back } from '../components/icons'
import { PasswordConfirm } from '../components/PasswordConfirm'

const STATUS: Record<AdminUser['status'], string> = { draft: 'Draft: no link sent', invited: 'Invited: waiting for them', active: 'Active', locked: 'Locked (too many wrong passwords)', disabled: 'Disabled' }

/** The invite link is shown once and exists nowhere else (the server stores only its hash). */
function InviteBox({ invite, onClose }: { invite: Invite; onClose: () => void }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle')
  const field = useRef<HTMLInputElement>(null)
  // The Clipboard API exists only on secure pages (HTTPS, localhost). Over plain HTTP on the LAN it is missing,
  // so fall back to the old copy command, and if that fails too, select the link and ask for the shortcut.
  const copyLink = async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard')
      await navigator.clipboard.writeText(invite.link)
      setCopy('copied')
    } catch {
      field.current?.focus()
      field.current?.select()
      setCopy(document.execCommand?.('copy') ? 'copied' : 'manual')
    }
  }
  return (
    <section className="panelbox invite-box" role="status">
      <h2>Invite link for {invite.user.firstName}</h2>
      <p className="lede">Send it to them privately. It works once and expires in {invite.expiresInHours} hours. This is the only time you’ll see it.</p>
      <input ref={field} readOnly value={invite.link} onFocus={(e) => e.currentTarget.select()} aria-label="One-time link" />
      {copy === 'manual' && <p className="form-hint">The link is selected: press {/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘C' : 'Ctrl+C'} to copy it.</p>}
      <div className="form-actions">
        <button type="button" className="btn primary" onClick={() => void copyLink()}>{copy === 'copied' ? 'Copied' : 'Copy link'}</button>
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </div>
    </section>
  )
}

const fullName = (u: AdminUser) => [u.firstName, u.lastName].filter(Boolean).join(' ')

export default function Users() {
  const me = useMe()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  /** The row whose request is running (its controls are disabled meanwhile), and the last row's outcome. */
  const [pending, setPending] = useState<string | null>(null)
  const [rowMsg, setRowMsg] = useState<{ id: string; text: string; error?: boolean } | null>(null)
  const [invite, setInvite] = useState<Invite | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [form, setForm] = useState({ login: '', firstName: '', lastName: '', role: 'user' as Role })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers())
      setLoadError('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Something went wrong.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  /** Run one row's action: one at a time per page, then say what happened next to that row. */
  const act = async (u: AdminUser, fn: () => Promise<unknown>, done?: string) => {
    if (pending) return
    setPending(u.id)
    setRowMsg(null)
    try {
      await fn()
      if (done) setRowMsg({ id: u.id, text: done })
    } catch (e) {
      setRowMsg({ id: u.id, text: e instanceof Error ? e.message : 'Something went wrong.', error: true })
    }
    await load()
    setPending(null)
  }

  return (
    <div className="container page">
      <Link to="/" className="back"><Back /> My CVs</Link>
      <h1>Users</h1>
      <p className="lede">There is no sign-up: you prepare each persona, then send its owner a one-time invite link. Administrators manage accounts only: nobody, including you, can open another person’s CVs.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {invite && <InviteBox invite={invite} onClose={() => setInvite(null)} />}

      <section className="panelbox" aria-labelledby="add-h">
        <h2 id="add-h">Prepare a persona</h2>
        <p className="lede">A name and the email they’ll sign in with. Nobody can sign in yet: generate the invite link when you’re ready. They choose their own password and fill in the rest of their details themselves.</p>
        <form
          className="form user-add"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError('')
            try {
              await createDraft(form)
              setForm({ login: '', firstName: '', lastName: '', role: 'user' })
              await load()
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Something went wrong.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="field"><label htmlFor="u-first">First name</label><input id="u-first" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
          <div className="field"><label htmlFor="u-last">Last name</label><input id="u-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
          <div className="field"><label htmlFor="u-login">Email</label><input id="u-login" type="email" required value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} /></div>
          <div className="field"><label htmlFor="u-role">Role</label>
            <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}><option value="user">Person</option><option value="admin">Administrator</option></select>
          </div>
          <div className="form-actions"><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button></div>
        </form>
      </section>

      {!users ? (
        loadError
          ? <div className="state-box inline" role="alert"><h2>Couldn’t load the people</h2><p>{loadError}</p><button type="button" className="btn" onClick={() => { setLoadError(''); void load() }}>Try again</button></div>
          : <div className="state-box" aria-busy="true"><p>Loading…</p></div>
      ) : (
        <div className="table-wrap">
          <table className="users-table">
            <thead><tr><th>Person</th><th>Status</th><th>CVs</th><th>AI</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me.persona.id
                const who = fullName(u)
                const busyRow = pending === u.id
                const msg = rowMsg?.id === u.id ? rowMsg : null
                return (
                  <tr key={u.id}>
                    <td data-label="Person"><strong>{u.firstName} {u.lastName}</strong>{self && ' (you)'}<br /><small>{u.login ?? 'no sign-in email'}{u.role === 'admin' ? ' · administrator' : ''}</small></td>
                    <td data-label="Status">{STATUS[u.status]}</td>
                    <td data-label="CVs">{u.resumeCount}</td>
                    <td data-label="AI">
                      {u.role === 'admin' ? <small title="Administrators always have AI">Always</small> : (
                        <label className="switch">
                          <input type="checkbox" role="switch" checked={u.aiEnabled} disabled={busyRow} onChange={(e) => void act(u, () => patchUser(u.id, { aiEnabled: e.target.checked }))} aria-label={`AI features for ${who}`} />
                          <span>{u.aiEnabled ? 'On' : 'Off'}</span>
                        </label>
                      )}
                    </td>
                    <td data-label="Last sign-in">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                    <td className="row-actions" aria-busy={busyRow}>
                      {deleting === u.id ? (
                        <PasswordConfirm label={`Delete ${u.firstName}`} onCancel={() => setDeleting(null)} onConfirm={async (pw) => { await deleteUser(u.id, pw); setDeleting(null); await load() }} />
                      ) : (
                        <>
                          {u.status === 'draft' || u.status === 'invited'
                            ? <button type="button" className="btn small primary" disabled={busyRow} aria-label={`${u.status === 'invited' ? 'New invite link' : 'Generate invite link'} for ${who}`} onClick={() => void act(u, async () => setInvite(await reissueInvite(u.id)))}>{u.status === 'invited' ? 'New invite link' : 'Generate invite link'}</button>
                            : <button type="button" className="btn small" disabled={busyRow} aria-label={`Reset password for ${who}`} onClick={() => void act(u, async () => setInvite(await reissueInvite(u.id)))}>Reset password</button>}
                          {!self && <button type="button" className="btn small" disabled={busyRow} aria-label={`${u.role === 'admin' ? 'Remove administrator role from' : 'Make administrator:'} ${who}`} onClick={() => void act(u, () => patchUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' }), u.role === 'admin' ? `${u.firstName} is no longer an administrator.` : `${u.firstName} is now an administrator.`)}>{u.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>}
                          {!self && <button type="button" className="btn small" disabled={busyRow} aria-label={`${u.isActive ? 'Disable' : 'Enable'} ${who}`} onClick={() => void act(u, () => patchUser(u.id, { isActive: !u.isActive }), u.isActive ? `${u.firstName} can no longer sign in.` : `${u.firstName} can sign in again.`)}>{u.isActive ? 'Disable' : 'Enable'}</button>}
                          {!self && <button type="button" className="btn small" disabled={busyRow} aria-label={`Sign ${who} out on every device`} title="Ends their sessions on every device" onClick={() => void act(u, () => signUserOut(u.id), `${u.firstName} was signed out on every device.`)}>Sign them out</button>}
                          {!self && <button type="button" className="btn small danger" disabled={busyRow} aria-label={`Delete ${who}…`} onClick={() => setDeleting(u.id)}>Delete…</button>}
                          {msg && <p className={msg.error ? 'form-error row-msg' : 'row-msg'} role={msg.error ? 'alert' : 'status'}>{msg.text}</p>}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
