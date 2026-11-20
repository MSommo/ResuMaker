import { useEffect, useRef, useState } from 'react'
import { Close, Lock, Sparkle } from '../components/icons'

/**
 * The one place that tells someone AI isn't included in their account. Every locked AI feature shows this, so when the
 * paywall arrives, its call to action (plans, checkout) goes here and nowhere else.
 */
export function UpgradeNote({ feature, compact = false, bar = false }: { feature?: string; compact?: boolean; bar?: boolean }) {
  // `bar`: one short line where a control would be (the assistant's message box), not a paragraph.
  if (bar)
    return (
      <div className="upgrade-bar" role="note">
        <span className="upgrade-bar-icon" aria-hidden><Lock /></span>
        <span className="upgrade-bar-text">
          <strong>AI is off for your account</strong>
          <small>Ask your administrator to turn it on.</small>
        </span>
        <span className="upgrade-badge"><Sparkle /> Upgrade</span>
      </div>
    )
  return (
    <div className={`upgrade-note ${compact ? 'compact' : ''}`} role="note">
      <span className="upgrade-badge"><Sparkle /> Upgrade</span>
      <p>
        <strong>{feature ? `${feature} uses AI, which isn’t included in your account.` : 'AI features aren’t included in your account.'}</strong>{' '}
        Upgrade to import existing CVs, improve your writing, chat with the assistant and tailor CVs to job postings.
      </p>
      <small>Ask your administrator to turn on AI for your account.</small>
    </div>
  )
}

/** Stand-in for the floating AI assistant when AI is locked: same button, opens the upgrade note instead of the chat. */
export function LockedAssistant() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [open])
  return (
    <div className="ai-dial no-print" ref={ref}>
      {open && (
        <div className="upgrade-pop" role="dialog" aria-label="AI assistant">
          <UpgradeNote feature="The assistant" compact />
        </div>
      )}
      <button type="button" className={`ai-fab locked ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="AI assistant (upgrade to use)" aria-expanded={open} title="AI assistant: upgrade to use">
        {open ? <Close /> : <><Sparkle /><Lock className="fab-lock" /></>}
      </button>
    </div>
  )
}
