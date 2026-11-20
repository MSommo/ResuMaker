import { useEffect, useRef, useState } from 'react'
import { chatHistory, chatStream, clearChat, decideProposal, restoreVersion, type ChatResult, type Proposal } from '../api/client'
import { useCaps } from '../api/Caps'
import { Chat, Close, Send, Sparkle, Stop, Target, Trash, Undo } from '../components/icons'
import { Menu, MenuItem } from '../components/Popover'
import { useResume } from '../state/ResumeContext'
import { MemoryDialog } from './MemoryDialog'
import { TailorDialog } from './TailorDialog'
import { LockedAssistant, UpgradeNote } from './Upgrade'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  applied?: string[]
  skipped?: string[]
  /** Server-side snapshot taken just before this message's changes. Restoring it is Undo (durable: works after a reload). */
  undoVersionId?: string | null
  undone?: boolean
  error?: boolean
  /** A quiet line from the app rather than the assistant ("Stopped…"). */
  note?: boolean
}

const AUTO_KEY = 'resumaker.approveAll'
const readAuto = () => {
  try {
    return sessionStorage.getItem(AUTO_KEY) === '1' // sessionStorage: it ends with the tab, which is what "this session" means
  } catch {
    return false
  }
}

const SUGGESTIONS = [
  'Tighten my profile to 3 sentences',
  'Rewrite my latest job’s bullets to be more impactful',
  'Translate the whole CV to Italian',
  'Add a skill: Docker, level 4',
]

/** Floating assistant. The LangGraph agent on the server edits the saved CV; every change is listed and can be undone. */
export function ChatBubble() {
  const { id, personaId, adopt, flush } = useResume()
  const caps = useCaps()
  const [open, setOpen] = useState(false)
  const [dial, setDial] = useState(false) // the launcher's two choices: Ask AI / Tailor to a job
  const dialRef = useRef<HTMLDivElement>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Thinking…')
  const [tailoring, setTailoring] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  // Human in the loop by default: the assistant proposes and you approve. "Approve all" skips that until the tab session ends.
  const [auto, setAuto] = useState(readAuto)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const loaded = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** The request in flight, so Stop can cancel it. Nothing is saved until a run finishes, so stopping changes nothing. */
  const abort = useRef<AbortController | null>(null)
  const [streaming, setStreaming] = useState(false)
  useEffect(() => () => abort.current?.abort(), [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [msgs, busy, open])
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // The launcher closes on Escape and on a click anywhere else.
  useEffect(() => {
    if (!dial) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDial(false)
    const onPointer = (e: PointerEvent) => !dialRef.current?.contains(e.target as Node) && setDial(false)
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [dial])

  // The conversation lives in the database, so it survives reloads.
  useEffect(() => {
    if (!open || loaded.current) return
    loaded.current = true
    chatHistory(id)
      .then((h) => setMsgs((cur) => (cur.length ? cur : h.map((m) => ({ role: m.role, text: m.text, applied: m.applied, skipped: m.skipped, undoVersionId: m.undoVersionId, undone: m.undone })))))
      .catch(() => {})
  }, [open, id])

  const send = async (raw: string) => {
    const content = raw.trim()
    if (!content || busy || proposal) return
    setMsgs((m) => [...m, { role: 'user', text: content }])
    setText('')
    setBusy(true)
    setStreaming(true)
    const ctl = (abort.current = new AbortController())
    try {
      await flush() // the agent reads the saved CV, so make sure it has your latest edits
      setStatus('Thinking…')
      const out = await chatStream(id, content, auto ? 'apply' : 'propose', (ev) => ev.type === 'status' && setStatus(ev.label), ctl.signal)
      if ('runId' in out) {
        setProposal(out)
        setPicked(new Set(out.items.map((i) => i.index)))
      } else showResult(out)
    } catch (e) {
      if (ctl.signal.aborted) setMsgs((m) => [...m, { role: 'assistant', text: 'Stopped. Nothing was changed.', note: true }])
      else setMsgs((m) => [...m, { role: 'assistant', text: e instanceof Error ? e.message : 'Something went wrong.', error: true }])
    } finally {
      abort.current = null
      setStreaming(false)
      setBusy(false)
      inputRef.current?.focus()
    }
  }
  const stop = () => abort.current?.abort()

  const changeAuto = (on: boolean) => {
    setAuto(on)
    try {
      on ? sessionStorage.setItem(AUTO_KEY, '1') : sessionStorage.removeItem(AUTO_KEY)
    } catch {
      /* private mode: the choice just lasts until reload */
    }
  }

  const selection = (): 'all' | number[] => (proposal && picked.size === proposal.items.length ? 'all' : [...picked].sort((a, b) => a - b))
  const approve = () => void decide(selection())
  const approveSession = () => {
    changeAuto(true)
    void decide(selection())
  }

  // Hotkeys for the review card: A approve, R reject, S approve all for this session, Ctrl/Cmd+Enter approve from anywhere.
  // The message box is disabled while a proposal waits, so plain letters are never typed into it.
  useEffect(() => {
    if (!open || !proposal || busy) return // a closed panel must never act on keys
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (picked.size) approve()
        return
      }
      const el = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable || (el instanceof HTMLInputElement && el.type !== 'checkbox')) return
      const k = e.key.toLowerCase()
      if (k === 'a' && picked.size) approve()
      else if (k === 'r') void decide('none')
      else if (k === 's' && picked.size) approveSession()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const showResult = (out: ChatResult) => {
    if (out.applied.length) adopt(out.resume.resume, out.resume.version)
    setMsgs((m) => [...m, { role: 'assistant', text: out.reply, applied: out.applied, skipped: out.skipped, undoVersionId: out.undoVersionId }])
  }

  const decide = async (accept: 'all' | 'none' | number[]) => {
    if (!proposal) return
    setBusy(true)
    setStatus('Applying…')
    try {
      await flush()
      showResult(await decideProposal(id, proposal.runId, accept))
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: e instanceof Error ? e.message : 'Could not apply the changes.', error: true }])
    } finally {
      setProposal(null)
      setBusy(false)
    }
  }

  const undo = async (i: number) => {
    const m = msgs[i]
    if (!m.undoVersionId) return
    setBusy(true)
    try {
      await flush() // don't let a pending autosave race the restore
      const out = await restoreVersion(id, m.undoVersionId) // server restores the snapshot taken before the change
      adopt(out.resume, out.version)
      setMsgs((all) => all.map((x, k) => (k === i ? { ...x, undone: true } : x)))
    } catch (e) {
      setMsgs((all) => [...all, { role: 'assistant', text: e instanceof Error ? e.message : 'Could not undo.', error: true }])
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    setMsgs([])
    await clearChat(id).catch(() => {})
  }
  // Only the newest applied change can be undone, otherwise we'd silently revert later ones too.
  const lastApplied = msgs.map((m, i) => (m.undoVersionId && !m.undone ? i : -1)).filter((i) => i >= 0).pop()

  // AI turned off (by an administrator, or not included): the launcher becomes the locked one. An open conversation stays
  // readable, with the upgrade note where the message box was.
  if (!caps.ai && !open) return <LockedAssistant />

  return (
    <>
      {!open && (
        <div className="ai-dial no-print" ref={dialRef}>
          {dial && (
            <div className="ai-dial-items" role="menu" aria-label="AI assistant">
              <button type="button" role="menuitem" className="ai-dial-item" onClick={() => (setDial(false), setTailoring(true))}>
                <Target /> Tailor to a job
              </button>
              <button type="button" role="menuitem" className="ai-dial-item" onClick={() => (setDial(false), setOpen(true))}>
                <Chat /> Ask AI
              </button>
            </div>
          )}
          <button type="button" className={`ai-fab ${dial ? 'on' : ''}`} onClick={() => setDial((d) => !d)} aria-label="AI assistant" aria-expanded={dial} aria-haspopup="menu" title="AI assistant">
            {dial ? <Close /> : <Sparkle />}
          </button>
        </div>
      )}
      {open && (
        <section className="chat no-print" role="dialog" aria-label="AI assistant">
          <header>
            <h2><Sparkle /> AI assistant</h2>
            <span className="tb-grow" />
            <Menu label="Assistant settings" triggerClassName="icon-btn">
              <MenuItem onSelect={() => setMemoryOpen(true)} icon={<Sparkle />}>What I remember about this person</MenuItem>
              <MenuItem onSelect={() => void clear()} icon={<Trash />} disabled={msgs.length === 0}>Clear conversation</MenuItem>
            </Menu>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant"><Close /></button>
          </header>

          <div className="chat-log" aria-live="polite">
            {msgs.length === 0 && caps.ai && (
              <div className="chat-intro">
                <p>Ask me to rewrite, translate, add or reorganise things. I edit the CV directly, and you can undo any change.</p>
                <div className="ai-chips">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => void send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role} ${m.error ? 'err' : ''} ${m.note ? 'note' : ''}`}>
                <p>{m.text}</p>
                {m.applied && m.applied.length > 0 && (
                  <ul className="applied">
                    {m.applied.map((a, k) => <li key={k}>{a}</li>)}
                  </ul>
                )}
                {m.skipped && m.skipped.length > 0 && <p className="skipped">Couldn’t apply {m.skipped.length} change{m.skipped.length > 1 ? 's' : ''}: {m.skipped.join('; ')}</p>}
                {m.undoVersionId && (m.undone ? <small className="undone">Undone</small> : lastApplied === i && <button type="button" className="btn small" disabled={busy} onClick={() => void undo(i)}><Undo /> Undo</button>)}
              </div>
            ))}
            {busy && <div className="msg assistant"><p className="ai-status"><Sparkle className="spin" /> {status}</p></div>}
            {proposal && (
              <div className="msg assistant proposal">
                <p>{proposal.reply}</p>
                <p><strong>Review the proposed changes:</strong></p>
                <ul className="applied">
                  {proposal.items.map((it) => (
                    <li key={it.index}>
                      <label>
                        <input type="checkbox" checked={picked.has(it.index)} disabled={busy} onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(it.index) : n.delete(it.index); return n })} /> {it.summary}
                      </label>
                    </li>
                  ))}
                </ul>
                {proposal.skipped.length > 0 && <p className="skipped">Couldn’t prepare {proposal.skipped.length}: {proposal.skipped.join('; ')}</p>}
                <div className="proposal-actions">
                  <button type="button" className="btn small primary" disabled={busy || picked.size === 0} onClick={approve}>Approve{picked.size === proposal.items.length ? '' : ` ${picked.size} selected`} <kbd>A</kbd></button>
                  <button type="button" className="btn small" disabled={busy} onClick={() => void decide('none')}>Reject <kbd>R</kbd></button>
                  <button type="button" className="btn small" disabled={busy || picked.size === 0} title="Apply these and stop asking until this browser tab session ends. You can still Undo." onClick={approveSession}>Approve all for this session <kbd>S</kbd></button>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {caps.ai ? (
            <form className="chat-form" onSubmit={(e) => (e.preventDefault(), void send(text))}>
              <div className={`composer ${proposal ? 'disabled' : ''}`}>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={text}
                  disabled={!!proposal}
                  placeholder={proposal ? 'Approve or reject the changes above first' : 'Ask for a change…'}
                  aria-label="Message"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void send(text))}
                />
                {streaming ? (
                  <button type="button" className="composer-btn stop" onClick={stop} aria-label="Stop" title="Stop (nothing is changed)"><Stop /></button>
                ) : (
                  <button type="submit" className="composer-btn" disabled={busy || !!proposal || !text.trim()} aria-label="Send" title="Send (Enter)"><Send /></button>
                )}
              </div>
            </form>
          ) : (
            <div className="chat-locked"><UpgradeNote bar /></div>
          )}
          {auto && (
            <div className="ai-note approval-mode">
              <span>Approve all is on for this session: changes apply right away (you can still Undo).</span>
              <button type="button" className="link-btn" onClick={() => changeAuto(false)}>Turn off</button>
            </div>
          )}
          {caps.ai && <small className="ai-note">Your CV text is sent to an AI service to answer. AI can make mistakes. Check the changes.</small>}
        </section>
      )}
      {tailoring && <TailorDialog id={id} onClose={() => setTailoring(false)} />}
      {memoryOpen && personaId && <MemoryDialog personaId={personaId} onClose={() => setMemoryOpen(false)} />}
    </>
  )
}
