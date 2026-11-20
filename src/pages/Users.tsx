import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createDraft, deleteUser, listUsers, patchUser, reissueInvite, signUserOut, type AdminUser, type Invite, type Role } from '../api/client'
import { useMe } from '../auth/AuthContext'
import { Back } from '../components/icons'
import { PasswordConfirm } from '../components/PasswordConfirm'

const STATUS: Record<AdminUser['status'], string> = { draft: 'Draft: no link sent', invited: 'Invited: waiting for them', active: 'Active', locked: 'Locked (too many wrong passwords)', disabled: 'Disabled' }

/** The invite link is shown once and exists nowhere else (the server stores only its hash). */
function InviteBox({ invite, onClose }: { invite: Invite; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <section className="panelbox invite-box" role="status">
      <h2>Invite link for {invite.user.firstName}</h2>
      <p className="lede">Send it to them privately. It works once and expires in {invite.expiresInHours} hours. This is the only time you’ll see it.</p>
      <input readOnly value={invite.link} onFocus={(e) => e.currentTarget.select()} aria-label="One-time link" />
      <div className="form-actions">
        <button type="button" className="btn primary" onClick={() => void navigator.clipboard.writeText(invite.link).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy link'}</button>
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </div>
    </section>
  )
}

export default function Users() {
  const me = useMe()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState('')
  const [invite, setInvite] = useState<Invite | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [form, setForm] = useState({ login: '', firstName: '', lastName: '', role: 'user' as Role })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') }
    await load()
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

      {!users ? <div className="state-box" aria-busy="true"><p>Loading…</p></div> : (
        <div className="table-wrap">
          <table className="users-table">
            <thead><tr><th>Person</th><th>Status</th><th>CVs</th><th>AI</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me.persona.id
                return (
                  <tr key={u.id}>
                    <td data-label="Person"><strong>{u.firstName} {u.lastName}</strong>{self && ' (you)'}<br /><small>{u.login ?? 'no sign-in email'}{u.role === 'admin' ? ' · administrator' : ''}</small></td>
                    <td data-label="Status">{STATUS[u.status]}</td>
                    <td data-label="CVs">{u.resumeCount}</td>
                    <td data-label="AI">
                      {u.role === 'admin' ? <small title="Administrators always have AI">Always</small> : (
                        <label className="switch">
                          <input type="checkbox" role="switch" checked={u.aiEnabled} onChange={(e) => void act(() => patchUser(u.id, { aiEnabled: e.target.checked }))} aria-label={`AI features for ${u.firstName}`} />
                          <span>{u.aiEnabled ? 'On' : 'Off'}</span>
                        </label>
                      )}
                    </td>
                    <td data-label="Last sign-in">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                    <td className="row-actions">
                      {deleting === u.id ? (
                        <PasswordConfirm label={`Delete ${u.firstName}`} onCancel={() => setDeleting(null)} onConfirm={async (pw) => { await deleteUser(u.id, pw); setDeleting(null); await load() }} />
                      ) : (
                        <>
                          {u.status === 'draft' || u.status === 'invited'
                            ? <button type="button" className="btn small primary" onClick={() => void act(async () => setInvite(await reissueInvite(u.id)))}>{u.status === 'invited' ? 'New invite link' : 'Generate invite link'}</button>
                            : <button type="button" className="btn small" onClick={() => void act(async () => setInvite(await reissueInvite(u.id)))}>Reset password</button>}
                          {!self && <button type="button" className="btn small" onClick={() => void act(() => patchUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' }))}>{u.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>}
                          {!self && <button type="button" className="btn small" onClick={() => void act(() => patchUser(u.id, { isActive: !u.isActive }))}>{u.isActive ? 'Disable' : 'Enable'}</button>}
                          {!self && <button type="button" className="btn small" onClick={() => void act(() => signUserOut(u.id))}>Sign out</button>}
                          {!self && <button type="button" className="btn small danger" onClick={() => setDeleting(u.id)}>Delete…</button>}
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
