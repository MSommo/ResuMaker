import { useId, type ReactNode } from 'react'
import { Info } from './icons'

/** A small (i) that explains something in a bubble on hover, keyboard focus or tap, instead of a paragraph of text. */
export function Hint({ children, label = 'More information' }: { children: ReactNode; label?: string }) {
  const id = useId()
  return (
    <span className="hint">
      <button type="button" className="hint-btn" aria-label={label} aria-describedby={id}><Info width={15} height={15} /></button>
      <span role="tooltip" id={id} className="hint-tip">{children}</span>
    </span>
  )
}
