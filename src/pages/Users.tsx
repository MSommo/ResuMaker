import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createDraft, deleteUser, listUsers, patchUser, reissueInvite, signUserOut, type AdminUser, type Invite, type Role } from '../api/client'
import { useMe } from '../auth/AuthContext'
import { Back, Lock, Refresh, SignOut, Trash, User } from '../components/icons'
import { PasswordConfirm } from '../components/PasswordConfirm'
import { Menu, MenuItem, MenuSep } from '../components/Popover'

const STATUS: Record<AdminUser['status'], string> = { draft: 'Draft: no link sent', invited: 'Invited: waiting for them', active: 'Active', locked: 'Locked (too many wrong passwords)', disabled: 'Disabled' }

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The link is shown once and exists nowhere else (the server stores only its hash). */
function InviteBox({ invite, onClose }: { invite: Invite; onClose: () => void }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle')
  const box = useRef<HTMLElement>(null)
  const field = useRef<HTMLInputElement>(null)
  // A person who has no password yet gets an invite; anyone else gets a reset link.
  const reset = invite.user.status !== 'draft' && invite.user.status !== 'invited'

  // The button that asked for the link may be far down the table: bring the link to the admin.
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' })
    field.current?.focus({ preventScroll: true })
  }, [invite])

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
    <section ref={box} className="panelbox invite-box" aria-labelledby="invite-h">
      <h2 id="invite-h">{reset ? `Password reset link for ${invite.user.firstName}` : `Invite link for ${invite.user.firstName}`}</h2>
      <p className="lede">
        Send it to them privately. It works once and expires in {invite.expiresInHours} hours.
        {reset && ' Their current password keeps working until they use it.'} This is the only time you’ll see it.
      </p>
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
/** Draft and invited people have no password yet: there is nothing to sign out of, disable or promote. */
const hasAccount = (u: AdminUser) => u.status !== 'draft' && u.status !== 'invited'
const cvs = (n: number) => (n === 1 ? 'their 1 CV' : `their ${n} CVs`)

export default function Users() {
  const me = useMe()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [formError, setFormError] = useState('')
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
  const link = (u: AdminUser) => act(u, async () => setInvite(await reissueInvite(u.id)))
  /** After cancelling a delete, focus goes back to the row's ⋯ button rather than to the page. */
  const cancelDelete = (id: string) => {
    setDeleting(null)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-row-menu="${id}"] button`)?.focus())
  }

  return (
    <div className="container page">
      <Link to="/" className="back"><Back /> My CVs</Link>
      <h1>Users</h1>
      <p className="lede">There is no sign-up: you prepare each persona, then send its owner a one-time invite link. Administrators manage accounts only: nobody, including you, can open another person’s CVs.</p>
      {invite && <InviteBox invite={invite} onClose={() => setInvite(null)} />}

      <section className="panelbox" aria-labelledby="add-h">
        <h2 id="add-h">Prepare a persona</h2>
        <p className="lede">A name and the email they’ll sign in with. Nobody can sign in yet: generate the invite link when you’re ready. They choose their own password and fill in the rest of their details themselves.</p>
        <form
          className="form user-add"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setFormError('')
            try {
              await createDraft(form)
              setForm({ login: '', firstName: '', lastName: '', role: 'user' })
              await load()
            } catch (err) {
              setFormError(err instanceof Error ? err.message : 'Something went wrong.')
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
          {formError && <p className="form-error user-add-error" role="alert">{formError}</p>}
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
                const account = hasAccount(u)
                // One visible action per row: the one the row's state calls for. Everything else is in the ⋯ menu.
                const main =
                  u.status === 'draft' ? { label: 'Generate invite link', run: () => link(u) }
                  : u.status === 'invited' ? { label: 'New invite link', run: () => link(u) }
                  : u.status === 'locked' && !self ? { label: 'Unlock + reset link', run: () => link(u) }
                  : u.status === 'disabled' && !self ? { label: 'Enable', run: () => act(u, () => patchUser(u.id, { isActive: true }), `${u.firstName} can sign in again.`) }
                  : null
                return (
                  <Fragment key={u.id}>
                    <tr className={deleting === u.id ? 'confirming' : undefined}>
                      <td data-label="Person"><strong>{who}</strong>{self && ' (you)'}<br /><small>{u.login ?? 'no sign-in email'}{u.role === 'admin' ? ' · administrator' : ''}</small></td>
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
                        {self ? (
                          <Link to="/account" className="btn small">Your account</Link>
                        ) : (
                          <>
                            {main && <button type="button" className="btn small primary" disabled={busyRow} aria-label={`${main.label} for ${who}`} onClick={() => void main.run()}>{main.label}</button>}
                            <span data-row-menu={u.id}>
                              <Menu label={`Actions for ${who}`}>
                                {account && u.status !== 'locked' && <MenuItem icon={<Refresh />} disabled={busyRow} onSelect={() => void link(u)}>Password reset link</MenuItem>}
                                {account && <MenuItem icon={<User />} disabled={busyRow} onSelect={() => void act(u, () => patchUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' }), u.role === 'admin' ? `${u.firstName} is no longer an administrator.` : `${u.firstName} is now an administrator.`)}>{u.role === 'admin' ? 'Remove administrator role' : 'Make administrator'}</MenuItem>}
                                {account && u.status !== 'disabled' && <MenuItem icon={<Lock />} disabled={busyRow} onSelect={() => void act(u, () => patchUser(u.id, { isActive: false }), `${u.firstName} can no longer sign in.`)}>Disable sign-in</MenuItem>}
                                {account && u.status !== 'disabled' && <MenuItem icon={<SignOut />} disabled={busyRow} onSelect={() => void act(u, () => signUserOut(u.id), `${u.firstName} was signed out on every device.`)}>Sign out on every device</MenuItem>}
                                {account && <MenuSep />}
                                <MenuItem icon={<Trash />} danger disabled={busyRow} onSelect={() => (setRowMsg(null), setDeleting(u.id))}>Delete…</MenuItem>
                              </Menu>
                            </span>
                          </>
                        )}
                        {msg && <p className={msg.error ? 'form-error row-msg' : 'row-msg'} role={msg.error ? 'alert' : 'status'}>{msg.text}</p>}
                      </td>
                    </tr>
                    {deleting === u.id && (
                      <tr className="confirm-row">
                        <td colSpan={6}>
                          <p><strong>Delete {who}</strong>{u.resumeCount ? ` and ${cvs(u.resumeCount)}` : ''}? This can’t be undone.</p>
                          <PasswordConfirm
                            label={`Delete ${u.firstName}`}
                            onCancel={() => cancelDelete(u.id)}
                            onConfirm={async (pw) => { await deleteUser(u.id, pw); setDeleting(null); await load() }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
