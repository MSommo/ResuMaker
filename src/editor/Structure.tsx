import { useLayoutEffect, useReducer, useRef, type MutableRefObject, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { accepts, type Zone } from '../layouts/registry'
import { KIND_LABEL, type Section } from '../model/types'
import { Chevron, Close, Edit, Grip, KindIcon } from '../components/icons'
import type { DragState } from './dnd'
import { useResume } from '../state/ResumeContext'

/** Where a dropped card was let go (viewport), so it can glide from there into its place. Cleared once used. */
export type Landing = MutableRefObject<{ id: string; left: number; top: number } | null>

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const MS = 200
const GAP = 6 // .zone-list row gap, in px
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function CardFace({ sec }: { sec: Section }) {
  return (
    <>
      <KindIcon kind={sec.kind} className="card-kind" />
      <span className="card-text">
        <strong>{sec.title || 'Untitled'}</strong>
        {/* A card titled "Text" or "Links" doesn't need its type spelled out a second time. */}
        {KIND_LABEL[sec.kind].toLowerCase() !== sec.title.trim().toLowerCase() && <small>{KIND_LABEL[sec.kind]}</small>}
      </span>
    </>
  )
}

function Card({ sec, source, onSelect, onStash }: { sec: Section; source: boolean; onSelect: (id: string) => void; onStash: (id: string) => void }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: sec.id, data: { type: 'section', id: sec.id } })
  // While it is being dragged the card itself is invisible and out of the flow (the gap stands in for it, wherever that
  // is), but keeps its size and place: the drag measures it to size and position the card under the pointer. Pinned to
  // where it last sat, since out of the flow a grid item would otherwise jump to the top of the list.
  const el = useRef<HTMLLIElement | null>(null)
  const top = useRef(0)
  useLayoutEffect(() => {
    if (!source && el.current) top.current = el.current.offsetTop
  })
  return (
    <li ref={(n) => ((el.current = n), setNodeRef(n))} className={`card ${source ? 'is-source' : ''}`} style={source ? { top: top.current } : undefined} {...(source ? {} : { 'data-flip': sec.id, 'data-slot': '' })}>
      <button type="button" className="grip" {...attributes} {...listeners} aria-label={`Move ${sec.title}. Press space, then use arrow keys.`}>
        <Grip />
      </button>
      <button type="button" className="card-main" onClick={() => onSelect(sec.id)} title="Edit content">
        <CardFace sec={sec} />
        <Chevron className="card-go" />
      </button>
      <button type="button" className="card-x" onClick={() => onStash(sec.id)} aria-label={`Remove ${sec.title} from the CV (content is kept)`} title="Remove from CV (content is kept)">
        <Close />
      </button>
    </li>
  )
}

/** The room a card would take. Opens smoothly when it arrives in a column, unless it starts out there (picking a card up). */
function Gap({ height, grow }: { height: number; grow: boolean }) {
  const ref = useRef<HTMLLIElement>(null)
  useLayoutEffect(() => {
    if (grow && !reduced()) ref.current?.animate([{ height: '0px', marginTop: `-${GAP}px`, opacity: 0 }, { height: `${height}px`, marginTop: '0px', opacity: 1 }], { duration: MS, easing: EASE })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- on arrival only
  return <li ref={ref} className="drop-gap" data-flip="@gap" style={{ height }} aria-hidden />
}

/** The gap just left this column: it closes instead of vanishing, so the cards below slide back up. */
function Closing({ height, onDone }: { height: number; onDone: () => void }) {
  const ref = useRef<HTMLLIElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || reduced()) return onDone()
    const a = el.animate([{ height: `${height}px`, marginTop: '0px', opacity: 1 }, { height: '0px', marginTop: `-${GAP}px`, opacity: 0 }], { duration: MS, easing: EASE, fill: 'forwards' })
    a.onfinish = onDone
    return () => a.cancel()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- runs once per closing gap
  return <li ref={ref} className="drop-gap closing" style={{ height }} aria-hidden />
}

/**
 * Cards that change place slide there (FLIP): their position is read just before React commits and again right after,
 * and the difference is played back. Reading the on-screen position (mid-animation included) keeps a slide that is
 * interrupted by the next move smooth. Positions are taken relative to the list, so a column above growing or shrinking
 * moves the whole list without making its cards wobble. A card that was just dropped glides in from where it was let go.
 */
function useFlip(list: MutableRefObject<HTMLUListElement | null>, skip: boolean, landing: Landing) {
  const before = new Map<string, number>()
  const el = list.current
  if (el) {
    // Read during render on purpose: this is the last moment the old layout is on screen.
    const top = el.getBoundingClientRect().top
    for (const c of el.querySelectorAll<HTMLElement>(':scope > [data-flip]')) if (c.offsetHeight) before.set(c.dataset.flip!, c.getBoundingClientRect().top - top)
  }
  useLayoutEffect(() => {
    const el = list.current
    if (!el || reduced()) return
    const top = el.getBoundingClientRect().top
    for (const c of el.querySelectorAll<HTMLElement>(':scope > [data-flip]')) {
      const id = c.dataset.flip!
      const land = landing.current?.id === id ? landing.current : null
      const was = before.get(id)
      if (!land && (skip || was === undefined)) continue
      for (const a of c.getAnimations()) if (a.id === 'flip') a.cancel()
      const r = c.getBoundingClientRect()
      if (land) {
        landing.current = null
        const dx = land.left - r.left
        const dy = land.top - r.top
        if (Math.abs(dx) + Math.abs(dy) < 1) continue
        const a = c.animate([{ transform: `translate(${dx}px, ${dy}px)`, boxShadow: 'var(--shadow)' }, { transform: 'none', boxShadow: 'none' }], { duration: 240, easing: EASE })
        a.id = 'flip'
        continue
      }
      const dy = was! - (r.top - top)
      if (Math.abs(dy) < 0.5) continue
      const a = c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: MS, easing: EASE })
      a.id = 'flip'
    }
  })
}

interface ColumnProps {
  zone: Zone
  title: string
  hint: string
  /** Fixed content above the movable cards (the header's name card). */
  lead?: ReactNode
  /** Draw nothing for the card list while it has no cards and no gap. */
  collapsible?: boolean
  sections: Section[]
  drag: DragState | null
  landing: Landing
  onSelect: (id: string) => void
  onStash: (id: string) => void
}

/**
 * Every column of the editor (Header, Sidebar, Main column…) is this one component, so they look and behave identically.
 * While dragging, a column that can take the component gets an accent border, one that can't turns red, and the one the
 * card would land in opens a gap at that exact spot: the other cards slide aside to make room for it.
 */
function Column({ zone, title, hint, lead, collapsible, sections, drag, landing, onSelect, onStash }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id: `zone:${zone.id}` })
  const list = useRef<HTMLUListElement | null>(null)
  const fits = !!drag && accepts(zone, drag.info.kind, drag.info.icon)
  const rejects = !!drag && !fits
  const gapAt = drag?.at?.zone === zone.id ? drag.at.index : null

  // Track the gap across renders: it grows in when it arrives here mid-drag, and closes when it leaves.
  const prev = useRef<{ gap: number | null; dragging: boolean; height: number }>({ gap: null, dragging: false, height: 0 })
  const closing = useRef<{ index: number; height: number; key: number } | null>(null)
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const p = prev.current
  const arrived = gapAt !== null && p.gap === null
  if (p.gap !== null && gapAt === null && drag) closing.current = { index: p.gap, height: p.height, key: Date.now() }
  if (gapAt !== null || !drag) closing.current = null
  // The gap opening or closing moves cards on its own (it animates its height): no sliding on top of that.
  useFlip(list, arrived || (p.gap !== null && gapAt === null), landing)
  useLayoutEffect(() => {
    prev.current = { gap: gapAt, dragging: !!drag, height: drag?.height ?? 0 }
  })

  const sourceId = drag?.info.from === zone.id ? drag.info.id : null
  const rest = sections.filter((s) => s.id !== sourceId)
  const close = closing.current
  const items: ReactNode[] = []
  const spacers = (i: number) => {
    if (gapAt === i) items.push(<Gap key="@gap" height={drag!.height} grow={p.dragging} />)
    if (close?.index === i) items.push(<Closing key={`@closing${close.key}`} height={close.height} onDone={() => ((closing.current = null), redraw())} />)
  }
  let i = 0
  for (const s of sections) {
    // The card being dragged stays mounted where it was, just before its own gap when the drag starts.
    if (s.id === sourceId) items.push(<Card key={s.id} sec={s} source onSelect={onSelect} onStash={onStash} />)
    else {
      spacers(i++)
      items.push(<Card key={s.id} sec={s} source={false} onSelect={onSelect} onStash={onStash} />)
    }
  }
  spacers(rest.length)

  // An empty column says so the same way whether or not something is being dragged: the colours are the drag's only hint.
  // A collapsible one (the header) stays closed until the gap actually arrives, then opens by growing it.
  const empty = !rest.length && gapAt === null && !close
  const collapsed = !!collapsible && empty
  return (
    <section ref={setNodeRef} className={`zone ${gapAt !== null ? 'over' : ''} ${rejects ? 'reject' : ''} ${fits ? 'offer' : ''}`}>
      <header>
        <h3>{title}</h3>
        <p>{rejects ? `This column can't hold ${KIND_LABEL[drag!.info.kind].toLowerCase()} blocks` : hint}</p>
      </header>
      {lead && <ul className="zone-list lead">{lead}</ul>}
      <ul ref={list} data-zone-list={zone.id} className={`zone-list drops ${collapsed ? 'collapsed' : ''}`}>
        {items}
        {empty && !collapsible && <li className="zone-empty">Drag components here</li>}
      </ul>
    </section>
  )
}

type Shared = Omit<ColumnProps, 'zone' | 'title' | 'hint' | 'lead' | 'collapsible'>

export const ZoneBox = ({ zone, ...rest }: Shared & { zone: Zone }) => <Column zone={zone} title={zone.label} hint={zone.hint} {...rest} />

/** The header: name and headline (always first, editable, not movable), then the few components the layout lets you place there. */
export function HeaderBlock({ zone, onSelectHeader, ...rest }: Shared & { zone: Zone | undefined; onSelectHeader: () => void }) {
  const { resume } = useResume()
  const headline = resume.basics.headline
  if (!zone) return null
  const lead = (
    <li className="card">
      <button type="button" className="card-main" onClick={onSelectHeader} title="Edit the headline (your name is in Personal info)">
        <Edit className="card-kind" />
        <span className="card-text"><strong>Headline</strong><small>{headline.trim() || 'Not set yet'}</small></span>
        <Chevron className="card-go" />
      </button>
    </li>
  )
  return <Column zone={zone} title="Header" hint="Your name and headline, always at the top" lead={lead} collapsible {...rest} />
}
