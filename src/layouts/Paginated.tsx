import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './paginated.css'

/** An unbreakable block of content. Columns are filled unit by unit, page by page. */
export interface Unit {
  key: string
  node: ReactNode
  /** Extra spacing after the unit: end of a section, or a section followed by a rule. */
  end?: 'section' | 'rule'
}

interface Props {
  className?: string
  header: ReactNode
  side: Unit[]
  main: Unit[]
}

type PageIdx = { side: number[]; main: number[] }

/** Greedy fill: returns, per page, the indices of the units that fit. */
/** `trail` is whitespace after a unit that doesn't matter when the unit is last on a page. */
function fill(heights: { h: number; trail: number }[], first: number, rest: number): number[][] {
  const pages: number[][] = [[]]
  let used = 0
  let avail = first
  heights.forEach(({ h, trail }, i) => {
    const cur = pages[pages.length - 1]
    if (cur.length > 0 && used + h - trail > avail + 0.5) {
      pages.push([])
      used = 0
      avail = rest
    }
    pages[pages.length - 1].push(i)
    used += h
  })
  return pages
}

const Units = ({ units, idx }: { units: Unit[]; idx: number[] }) => (
  <>
    {idx.map((i) => units[i]).filter(Boolean).map((u) => (
      <div key={u.key} className={`pg-unit ${u.end ? `end-${u.end}` : ''}`}>{u.node}</div>
    ))}
  </>
)

export function Paginated({ className = '', header, side, main }: Props) {
  const measure = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<PageIdx[]>([{ side: [], main: [] }])
  const [tick, setTick] = useState(0)

  // Re-measure once web fonts have loaded, since they change text metrics.
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    document.fonts?.ready.then(bump)
    document.fonts?.addEventListener('loadingdone', bump)
    return () => document.fonts?.removeEventListener('loadingdone', bump)
  }, [])

  const recompute = useCallback(() => {
    const m = measure.current
    if (!m) return
    const h = (sel: string) => m.querySelector<HTMLElement>(sel)!.getBoundingClientRect().height
    const inner = h('.pg-probe-inner')
    const pad = h('.pg-probe-pad')
    const headerH = h('.pg-m-header')
    const units = (sel: string) =>
      Array.from(m.querySelectorAll<HTMLElement>(`${sel} .pg-unit`)).map((e) => {
        const cs = getComputedStyle(e)
        // Margins sit outside the box, so add them or the gaps between units go uncounted.
        const margin = parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)
        return { h: e.getBoundingClientRect().height + margin, trail: parseFloat(cs.paddingBottom) + parseFloat(cs.marginBottom) + parseFloat(cs.borderBottomWidth) }
      })
    const first = inner - headerH - pad
    const rest = inner - h('.pg-probe-pad2')
    const s = fill(units('.pg-m-side'), first, rest)
    const mn = fill(units('.pg-m-main'), first, rest)
    const n = Math.max(s.length, mn.length)
    const next: PageIdx[] = Array.from({ length: n }, (_, p) => ({ side: s[p] ?? [], main: mn[p] ?? [] }))
    setPages((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [])

  useLayoutEffect(recompute, [side, main, header, tick, recompute])

  return (
    <div className={`pg ${className}`}>
      {/* Hidden copy rendered at full size so each unit can be measured. */}
      <div className="pg-measure" ref={measure} aria-hidden>
        <div className="pg-probe-inner" />
        <div className="pg-probe-pad" />
        <div className="pg-probe-pad2" />
        <div className="pg-page">
          <div className="pg-m-header">{header}</div>
          <div className="pg-body">
            <div className="pg-side pg-m-side"><Units units={side} idx={side.map((_, i) => i)} /></div>
            <div className="pg-main pg-m-main"><Units units={main} idx={main.map((_, i) => i)} /></div>
          </div>
        </div>
      </div>

      {/* Only the visible pages are scaled; measuring happens at true size so it matches print. */}
      <div className="pg-pages">
        {pages.map((p, n) => (
          <div className={`pg-page ${n > 0 ? 'pg-cont' : ''}`} key={n}>
            {n === 0 && <div className="pg-header">{header}</div>}
            <div className="pg-body">
              <div className="pg-side"><Units units={side} idx={p.side} /></div>
              <div className="pg-main"><Units units={main} idx={p.main} /></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
