import { useEffect, useRef, useState } from 'react'
import { chatHistory, chatStream, clearChat, decideProposal, restoreVersion, type ChatResult, type Proposal } from '../api/client'
import { Chat, Close, Send, Sparkle, Trash, Undo } from '../components/icons'
import { useResume } from '../state/ResumeContext'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  applied?: string[]
  skipped?: string[]
  /** Server-side snapshot taken just before this message's changes. Restoring it is Undo (durable: works after a reload). */
  undoVersionId?: string | null
  undone?: boolean
  error?: boolean
}

const SUGGESTIONS = [
  'Tighten my profile to 3 sentences',
  'Rewrite my latest job’s bullets to be more impactful',
  'Translate the whole CV to Italian',
  'Add a skill: Docker, level 4',
]

/** Floating assistant. The LangGraph agent on the server edits the saved CV; every change is listed and can be undone. */
export function ChatBubble() {
  const { id, adopt, flush } = useResume()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Thinking…')
  const [review, setReview] = useState(false) // propose changes first instead of applying them
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const loaded = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
    try {
      await flush() // the agent reads the saved CV, so make sure it has your latest edits
      setStatus('Thinking…')
      const out = await chatStream(id, content, review ? 'propose' : 'apply', (ev) => ev.type === 'status' && setStatus(ev.label))
      if ('runId' in out) {
        setProposal(out)
        setPicked(new Set(out.items.map((i) => i.index)))
      } else showResult(out)
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: e instanceof Error ? e.message : 'Something went wrong.', error: true }])
    } finally {
      setBusy(false)
    }
  }

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

  return (
    <>
      {!open && (
        <button type="button" className="ai-fab no-print" onClick={() => setOpen(true)} aria-label="Open AI assistant">
          <Chat /> <span>Ask AI</span>
        </button>
      )}
      {open && (
        <section className="chat no-print" role="dialog" aria-label="AI assistant">
          <header>
            <h2><Sparkle /> AI assistant</h2>
            <span className="tb-grow" />
            {msgs.length > 0 && <button type="button" className="icon-btn" onClick={() => void clear()} aria-label="Clear conversation" title="Clear conversation"><Trash /></button>}
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant"><Close /></button>
          </header>

          <div className="chat-log" aria-live="polite">
            {msgs.length === 0 && (
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
              <div key={i} className={`msg ${m.role} ${m.error ? 'err' : ''}`}>
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
                  <button type="button" className="btn small primary" disabled={busy || picked.size === 0} onClick={() => void decide(picked.size === proposal.items.length ? 'all' : [...picked].sort((a, b) => a - b))}>Apply {picked.size === proposal.items.length ? 'all' : `${picked.size} selected`}</button>
                  <button type="button" className="btn small" disabled={busy} onClick={() => void decide('none')}>Reject</button>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="chat-form" onSubmit={(e) => (e.preventDefault(), void send(text))}>
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              placeholder="Ask for a change…"
              aria-label="Message"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void send(text))}
            />
            <button type="submit" className="btn primary icon" disabled={busy || !!proposal || !text.trim()} aria-label="Send"><Send /></button>
          </form>
          <label className="ai-note review-toggle"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Review changes before applying</label>
          <small className="ai-note">Your CV text is sent to Google Gemini to answer. AI can make mistakes. Check the changes.</small>
        </section>
      )}
    </>
  )
}
