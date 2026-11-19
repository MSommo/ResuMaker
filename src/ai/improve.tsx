import { useRef, useState, type ReactNode } from 'react'
import { improve as improveApi } from '../api/client'
import { useCaps } from '../api/Caps'
import { Check, Close, Refresh, Sparkle } from '../components/icons'
import { useOptionalResume } from '../state/ResumeContext'

export interface ImproveContext {
  role?: string
  organisation?: string
  section?: string
}

/** Marks a field as improvable. `kind` selects the rewriting rules on the server (headline, summary, description, bullet, subheading, note, text). */
export interface ImproveSpec {
  kind: 'headline' | 'summary' | 'description' | 'bullet' | 'subheading' | 'note' | 'text'
  context?: ImproveContext
}

const REFINEMENTS = [
  ['Shorter', 'Make it noticeably shorter.'],
  ['More impact', 'Make it more impactful and results-oriented, without inventing facts or numbers.'],
  ['Simpler', 'Use simpler, plainer wording.'],
  ['Grammar only', 'Only fix grammar, spelling and punctuation; keep the wording otherwise.'],
] as const

/**
 * "Improve with AI" for one field. Returns the trigger button and the suggestion panel so each field can place them where it fits.
 * The suggestion is only applied when the user accepts it.
 */
export function useImprove(spec: ImproveSpec | undefined, value: string, onApply: (v: string) => void): { trigger: ReactNode; panel: ReactNode } {
  const caps = useCaps()
  const headline = useOptionalResume()?.resume.basics.headline ?? ''
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [instruction, setInstruction] = useState('')
  const ticket = useRef(0)

  if (!spec || !caps.ai) return { trigger: null, panel: null }

  const run = async (instr = '') => {
    const mine = ++ticket.current
    setBusy(true)
    setError('')
    try {
      const { text } = await improveApi({
        kind: spec.kind,
        text: value,
        instruction: instr,
        context: { ...spec.context, headline },
      })
      if (mine === ticket.current) setResult(text)
    } catch (e) {
      if (mine === ticket.current) setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      if (mine === ticket.current) setBusy(false)
    }
  }
  const close = () => {
    ticket.current++
    setOpen(false)
    setBusy(false)
    setResult('')
    setError('')
    setInstruction('')
  }
  const empty = !value.trim()

  const trigger = (
    <button
      type="button"
      className={`ai-btn ${open ? 'on' : ''}`}
      disabled={empty}
      onClick={() => (open ? close() : (setOpen(true), run()))}
      aria-expanded={open}
      title={empty ? 'Write something first' : 'Improve with AI'}
    >
      <Sparkle /> <span>Improve</span>
    </button>
  )

  const panel = open && (
    <div className="ai-panel" role="region" aria-label="AI suggestion" aria-live="polite">
      <div className="ai-chips">
        {REFINEMENTS.map(([label, instr]) => (
          <button key={label} type="button" disabled={busy} onClick={() => run(instr)}>{label}</button>
        ))}
      </div>
      <form className="ai-ask" onSubmit={(e) => (e.preventDefault(), instruction.trim() && run(instruction))}>
        <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Or tell the AI what to change…" aria-label="Custom instruction" />
        <button type="submit" className="btn small" disabled={busy || !instruction.trim()}>Go</button>
      </form>
      {busy && <p className="ai-status"><Sparkle className="spin" /> Writing a suggestion…</p>}
      {error && <p className="ai-status err">{error}</p>}
      {result && !busy && (
        <div className="ai-result">
          <p>{result}</p>
          <div className="ai-actions">
            <button type="button" className="btn small primary" onClick={() => (onApply(result), close())}><Check /> Use this</button>
            <button type="button" className="btn small" onClick={() => run(instruction)}><Refresh /> Try again</button>
            <button type="button" className="btn small" onClick={close}><Close /> Discard</button>
          </div>
        </div>
      )}
      <small className="ai-note">Your text is sent to Google Gemini to generate this suggestion.</small>
    </div>
  )
  return { trigger, panel }
}
