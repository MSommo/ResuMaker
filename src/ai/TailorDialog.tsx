import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, decideProposal, deleteResume, tailorStream, type JobSpec, type Proposal } from '../api/client'
import { Close, Sparkle } from '../components/icons'

type Stage = 'input' | 'working' | 'review' | 'applying'

/**
 * Tailor the current CV to a pasted job posting. The server creates a NEW variant CV (this one is never touched), shows what the
 * role needs and what your CV matches or lacks, and proposes changes on the variant. Nothing is applied until you accept.
 */
export function TailorDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const nav = useNavigate()
  const [posting, setPosting] = useState('')
  const [stage, setStage] = useState<Stage>('input')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [spec, setSpec] = useState<JobSpec | null>(null)
  const [proposal, setProposal] = useState<(Proposal & { resumeId: string }) | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stage !== 'applying' && void cancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const start = async () => {
    setStage('working')
    setError('')
    setStatus('Reading the job posting…')
    abort.current = new AbortController()
    try {
      const p = await tailorStream(id, posting.trim(), (ev) => {
        if (ev.type === 'status') setStatus(ev.label)
        if (ev.type === 'spec') setSpec(ev)
      }, abort.current.signal)
      setProposal(p)
      setPicked(new Set(p.items.map((i) => i.index)))
      setStage('review')
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.')
      setStage('input')
    }
  }

  const discard = async () => {
    if (!proposal) return
    await decideProposal(proposal.resumeId, proposal.runId, 'none').catch(() => {}) // frees the paused run
    await deleteResume(proposal.resumeId).catch(() => {}) // and the unused variant
  }
  const cancel = async () => {
    abort.current?.abort()
    await discard()
    onClose()
  }

  const apply = async () => {
    if (!proposal) return
    setStage('applying')
    try {
      await decideProposal(proposal.resumeId, proposal.runId, picked.size === proposal.items.length ? 'all' : [...picked].sort((a, b) => a - b))
      onClose()
      nav(`/editor/${proposal.resumeId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply the changes.')
      setStage('review')
    }
  }

  return (
    <div className="modal-backdrop no-print" role="presentation">
      <section className="modal tailor" role="dialog" aria-label="Tailor to a job">
        <header>
          <h2><Sparkle /> Tailor to a job</h2>
          <span className="tb-grow" />
          <button type="button" className="icon-btn" onClick={() => void cancel()} aria-label="Close" disabled={stage === 'applying'}><Close /></button>
        </header>

        {stage === 'input' && (
          <>
            <p className="tailor-help">Paste the job posting. I’ll make a <strong>new copy</strong> of this CV tailored to it, so the original stays as it is. I only rephrase and emphasise what is already in your CV; I never add experience you don’t have.</p>
            <textarea value={posting} onChange={(e) => setPosting(e.target.value)} rows={10} placeholder="Paste the full text of the job posting here…" aria-label="Job posting" autoFocus />
            {error && <p className="skipped">{error}</p>}
            <small className="ai-note">The posting and your CV text are sent to Google Gemini.</small>
            <div className="proposal-actions">
              <button type="button" className="btn primary" disabled={posting.trim().length < 40} onClick={() => void start()}>Tailor my CV</button>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {stage !== 'input' && (
          <div className="tailor-body">
            {spec && (
              <div className="tailor-spec">
                <p><strong>{spec.title || 'The role'}</strong>{spec.company ? ` at ${spec.company}` : ''}</p>
                {spec.summary && <p>{spec.summary}</p>}
                {spec.matched.length > 0 && <><h3>Your CV already shows</h3><ul className="applied">{spec.matched.map((m, i) => <li key={i}>{m}</li>)}</ul></>}
                {spec.gaps.length > 0 && <><h3>Not in your CV (I won’t invent these)</h3><ul className="gaps">{spec.gaps.map((m, i) => <li key={i}>{m}</li>)}</ul></>}
              </div>
            )}
            {stage === 'working' && <p className="ai-status"><Sparkle className="spin" /> {status}</p>}
            {(stage === 'review' || stage === 'applying') && proposal && (
              <>
                <p>{proposal.reply}</p>
                <h3>Proposed changes ({picked.size} of {proposal.items.length} selected)</h3>
                <ul className="applied proposal-list">
                  {proposal.items.map((it) => (
                    <li key={it.index}>
                      <label>
                        <input type="checkbox" checked={picked.has(it.index)} disabled={stage === 'applying'} onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(it.index) : n.delete(it.index); return n })} /> {it.summary}
                      </label>
                    </li>
                  ))}
                </ul>
                {proposal.skipped.length > 0 && <p className="skipped">Couldn’t prepare {proposal.skipped.length}: {proposal.skipped.join('; ')}</p>}
                {error && <p className="skipped">{error}</p>}
                <div className="proposal-actions">
                  <button type="button" className="btn primary" disabled={stage === 'applying' || picked.size === 0} onClick={() => void apply()}>{stage === 'applying' ? 'Creating…' : 'Create tailored CV'}</button>
                  <button type="button" className="btn" disabled={stage === 'applying'} onClick={() => void cancel()}>Discard</button>
                </div>
              </>
            )}
            {stage === 'working' && <div className="proposal-actions"><button type="button" className="btn" onClick={() => void cancel()}>Cancel</button></div>}
          </div>
        )}
      </section>
    </div>
  )
}
