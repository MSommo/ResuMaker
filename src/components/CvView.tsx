import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { getLayout } from '../layouts/registry'
import type { Resume } from '../model/types'
import { PAGE_W, useFit, type ZoomMode } from './useFit'

export function CvView({ resume }: { resume: Resume }) {
  const Layout = getLayout(resume.layoutId).Component
  return <Layout resume={resume} />
}

/**
 * Scrollable area that scales the CV to fit. Used by the editor and the fullscreen preview.
 * With `onSelectSection`, pointing at a part of the CV highlights its whole section and clicking it opens that section
 * (`"@info"` is the header, which shows the personal details).
 */
export function CvViewport({ resume, mode = 'width', max = 1, className = '', onSelectSection, activeSection }: {
  resume: Resume
  mode?: ZoomMode
  max?: number
  className?: string
  onSelectSection?: (id: string) => void
  activeSection?: string | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const fit = useFit(ref, mode, 24, max)
  const [hot, setHot] = useState<string | null>(null)
  const [boxes, setBoxes] = useState<Box[]>([])
  const secOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.('[data-sec]')?.getAttribute('data-sec') ?? null

  // One box per column of the section (a section can span columns' pages), drawn over the CV, so the highlight reads as one block.
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || !onSelectSection) return setBoxes([])
    const measure = () => {
      const vr = root.getBoundingClientRect()
      const out: Box[] = []
      const add = (id: string | null | undefined, kind: Box['kind']) => {
        if (!id) return
        const groups = new Map<Element, DOMRect>()
        root.querySelectorAll(`.pg-pages [data-sec="${CSS.escape(id)}"]`).forEach((el) => {
          const col = el.closest('.pg-side, .pg-main, .pg-header') ?? root
          const r = el.getBoundingClientRect()
          const g = groups.get(col)
          groups.set(col, g ? new DOMRect(Math.min(g.left, r.left), Math.min(g.top, r.top), Math.max(g.right, r.right) - Math.min(g.left, r.left), Math.max(g.bottom, r.bottom) - Math.min(g.top, r.top)) : r)
        })
        groups.forEach((r) => out.push({ kind, left: r.left - vr.left + root.scrollLeft - 6, top: r.top - vr.top + root.scrollTop - 6, width: r.width + 12, height: r.height + 12 }))
      }
      add(activeSection, 'active')
      if (hot !== activeSection) add(hot, 'hot')
      setBoxes(out)
    }
    measure()
    const t = setTimeout(measure, 150) // pagination settles a moment after an edit
    return () => clearTimeout(t)
  }, [hot, activeSection, resume, fit, onSelectSection])

  return (
    <div
      ref={ref}
      className={`viewport ${className} ${onSelectSection ? 'cv-live' : ''}`}
      style={{ '--fit': fit } as CSSProperties}
      onMouseOver={onSelectSection ? (e) => setHot(secOf(e.target)) : undefined}
      onMouseLeave={onSelectSection ? () => setHot(null) : undefined}
      onClick={
        onSelectSection
          ? (e) => {
              const id = secOf(e.target)
              if (!id) return
              e.preventDefault() // a link in the CV must not navigate away from the editor
              onSelectSection(id)
            }
          : undefined
      }
    >
      <CvView resume={resume} />
      {boxes.map((b, i) => (
        <span key={i} className={`cv-box ${b.kind}`} style={{ left: b.left, top: b.top, width: b.width, height: b.height }} aria-hidden />
      ))}
    </div>
  )
}

interface Box {
  kind: 'hot' | 'active'
  left: number
  top: number
  width: number
  height: number
}

/** First page only, as a card thumbnail. Not interactive. */
export function PageThumb({ resume }: { resume: Resume }) {
  const ref = useRef<HTMLDivElement>(null)
  const fit = useFit(ref, 'width', 0, 1)
  return (
    <div ref={ref} className="thumb" style={{ '--fit': fit, '--page-w': `${PAGE_W}px` } as CSSProperties} aria-hidden {...({ inert: '' } as object)}>
      <CvView resume={resume} />
    </div>
  )
}
