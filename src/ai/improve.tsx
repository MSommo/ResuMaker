import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
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

/** Floating card pinned next to the button that opened it (below it, or above when there is no room), so the suggestion appears where you are looking. */
function AnchoredPanel({ anchor, onClose, children }: { anchor: RefObject<HTMLElement>; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect()
    const el = ref.current
    if (!a || !el) return
    const width = Math.min(400, window.innerWidth - 16)
    const left = Math.min(Math.max(8, a.right - width), window.innerWidth - width - 8)
    const below = window.innerHeight - a.bottom - 14
    const above = a.top - 14
    const h = el.offsetHeight
    const next = h <= below || below >= above ? { top: a.bottom + 6, left, width, maxHeight: below } : { top: Math.max(8, a.top - 6 - Math.min(h, above)), left, width, maxHeight: above }
    // Only update when something moved, otherwise re-running this after every render would loop.
    setPos((p) => (p && p.top === next.top && p.left === next.left && p.width === next.width && p.maxHeight === next.maxHeight ? p : next))
  }, [anchor])
  useLayoutEffect(place)
  useEffect(() => {
    const el = ref.current
    const ro = el && new ResizeObserver(place)
    if (el) ro?.observe(el)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true) // the form scrolls inside its own panel
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (e.stopPropagation(), onClose())
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [place, onClose])
  return createPortal(
    <div ref={ref} className="ai-panel no-print" role="dialog" aria-label="AI suggestion" aria-live="polite" style={pos ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight } : { visibility: 'hidden', top: 0, left: 0 }}>
      {children}
    </div>,
    document.body,
  )
}

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
  const triggerRef = useRef<HTMLButtonElement>(null)

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
      ref={triggerRef}
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
    <AnchoredPanel anchor={triggerRef} onClose={close}>
      <div className="ai-panel-head">
        <strong><Sparkle /> Improve with AI</strong>
        <button type="button" className="icon-btn" onClick={close} aria-label="Close suggestion"><Close /></button>
      </div>
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
    </AnchoredPanel>
  )
  return { trigger, panel }
}
