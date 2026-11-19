import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { addressLines, birthLines, fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, IconId, Leveled, Resume, Section } from '../../model/types'
import { Paginated, type Unit } from '../Paginated'
import { Rich, entryLine, paragraphs, parseBullets } from '../shared'
import './timeline.css'

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    {children}
  </svg>
)

const ICONS: Record<IconId, ReactNode> = {
  none: (
    <Icon>
      <circle cx="12" cy="12" r="4" />
    </Icon>
  ),
  bookmark: (
    <Icon>
      <path d="M6 2h12a1 1 0 0 1 1 1v19l-7-4-7 4V3a1 1 0 0 1 1-1z" />
    </Icon>
  ),
  user: (
    <Icon>
      <circle cx="12" cy="7.5" r="4.5" />
      <path d="M3 22c0-5 4-8 9-8s9 3 9 8z" />
    </Icon>
  ),
  briefcase: (
    <Icon>
      <path d="M9 3h6a2 2 0 0 1 2 2v2h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4V5a2 2 0 0 1 2-2zm0 2v2h6V5z" />
    </Icon>
  ),
  badge: (
    <Icon>
      <path d="M12 1l3 2 3.6-.2 1 3.5 3 2-1.2 3.4 1.2 3.4-3 2-1 3.5L15 21l-3 2-3-2-3.6.2-1-3.5-3-2L3.6 12 2.4 8.6l3-2 1-3.5L9 3z" />
      <path d="M7.5 12.2l3 3 6-6.2" fill="none" stroke="#fff" strokeWidth="2.2" />
    </Icon>
  ),
  cap: (
    <Icon>
      <path d="M12 3L1 9l11 6 9-4.9V17h2V9zM5 13.2V17c0 1.7 3.1 3.5 7 3.5s7-1.8 7-3.5v-3.8l-7 3.8z" />
    </Icon>
  ),
  star: (
    <Icon>
      <path d="M12 1.5l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6l-6.4 3.5 1.4-7.1-5.3-5 7.2-.9z" />
    </Icon>
  ),
}

const Dot = () => <span className="tm-dot" />

/** Pieces of one entry; the first carries the title line and its timeline dot. */
function entryPieces(en: Entry, job: boolean): ReactNode[] {
  const dates = entryDates(en)
  const head = (
    <>
      <div className="tm-title tm-rel">
        <Dot />
        {entryLine(en, job)}
      </div>
      {dates && <div className="tm-dates">{dates}</div>}
      {en.note && <div className="tm-note"><Rich text={en.note} /></div>}
    </>
  )
  const body: ReactNode[] = en.description ? paragraphs(en.description, 'tm-text') : []

  let pending: ReactNode = null
  parseBullets(en.bullets).forEach((b, i) => {
    if (b.type === 'heading') {
      if (pending) body.push(pending)
      pending = (
        <div key={`h${i}`} className="tm-sub">
          <Rich text={b.text} />
        </div>
      )
    } else {
      body.push(
        <div key={`b${i}`}>
          {pending}
          <ul className="tm-bullets">
            <li>
              <Rich text={b.text} />
            </li>
          </ul>
        </div>,
      )
      pending = null
    }
  })
  if (pending) body.push(pending)

  return body.length ? [<div key="head">{head}{body[0]}</div>, ...body.slice(1)] : [head]
}

/** A timeline section: icon heading + rail; every piece is its own page-breakable unit. */
function timelineSection(key: string, title: string, icon: ReactNode, entries: ReactNode[][]): Unit[] {
  const flat = entries.flatMap((pieces, ei) => pieces.map((node, pi) => ({ node, gap: pi === pieces.length - 1 && ei < entries.length - 1 })))
  return flat.map((p, i) => ({
    key: `${key}-${i}`,
    end: i === flat.length - 1 ? 'section' : undefined,
    node: (
      <div className={`tm-piece ${i === 0 ? 'tm-first' : ''} ${p.gap ? 'tm-gap' : ''}`}>
        {i === 0 && (
          <h2 className="tm-h">
            <span className="tm-icon">{icon}</span>
            {title}
          </h2>
        )}
        {p.node}
      </div>
    ),
  }))
}

function sideSection(key: string, title: string, items: ReactNode[]): Unit[] {
  return items.map((node, i) => ({
    key: `${key}-${i}`,
    end: i === items.length - 1 ? 'section' : undefined,
    node: (
      <div>
        {i === 0 && <h2 className="tm-side-h">{title}</h2>}
        {node}
      </div>
    ),
  }))
}

const Bar = ({ level }: { level: number }) => (
  <div className="tm-bar">
    <div style={{ width: `${(Math.min(5, Math.max(0, level)) / 5) * 100}%` }} />
  </div>
)

const levelRow = (s: Leveled) => (
  <div key={s.id} className="tm-level">
    <div className="tm-level-name">{s.name}</div>
    <Bar level={s.level} />
  </div>
)

function details(b: Basics): ReactNode {
  const group = (label: string, lines: string[], link = false) =>
    lines.length > 0 && (
      <div className={`tm-detail ${label ? 'lab' : ''}`} key={label || lines[0]}>
        {label && <div className="tm-label">{label}</div>}
        {lines.map((l, i) => (
          <div key={i} className={link ? 'tm-ul' : undefined}>
            {l}
          </div>
        ))}
      </div>
    )
  return (
    <>
      {group('', addressLines(b))}
      {group('', [b.phone].filter(Boolean), true)}
      {group('', [b.email].filter(Boolean), true)}
      {group('Date / Place of birth', birthLines(b))}
      {group('Nationality', [b.nationality].filter(Boolean))}
    </>
  )
}

function sideUnits(sec: Section, b: Basics): Unit[] {
  const nodes: ReactNode[] = (() => {
    switch (sec.kind) {
      case 'details': return [details(b)]
      case 'text': return paragraphs(sec.text, 'tm-hobby')
      case 'levels': return sec.items.map(levelRow)
      case 'links':
        return sec.items.map((l) => (
          <a key={l.id} className="tm-link" href={l.url}>
            {l.label}
          </a>
        ))
      default: return []
    }
  })()
  return nodes.length ? sideSection(sec.id, sec.title, nodes) : []
}

function mainUnits(sec: Section): Unit[] {
  const icon = ICONS[sec.icon]
  if (sec.kind === 'text') {
    const ps = paragraphs(sec.text, 'tm-text')
    if (!ps.length) return []
    // A text block is a single timeline entry: dot on its first paragraph.
    return timelineSection(sec.id, sec.title, icon, [[<div className="tm-rel" key="p"><Dot />{ps[0]}</div>, ...ps.slice(1)]])
  }
  if (sec.kind === 'entries' && sec.items.length) return timelineSection(sec.id, sec.title, icon, sec.items.map((e) => entryPieces(e, sec.job)))
  return []
}

export function TimelineLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const location = locationLine(b)
  const side = zoneSections(r, 'side').flatMap((s) => sideUnits(s, b))
  const main = zoneSections(r, 'main').flatMap(mainUnits)

  const header = (
    <header className="tm-header">
      <h1>{fullName(b)}</h1>
      <div className="tm-contact">
        {b.headline && <span>{b.headline}</span>}
        {location && (
          <span>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 1a7.5 7.5 0 0 0-7.5 7.5C4.5 14 12 23 12 23s7.5-9 7.5-14.5A7.5 7.5 0 0 0 12 1zm0 10.3a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6z" />
            </svg>
            {location}
          </span>
        )}
        {b.phone && (
          <span>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.5.57 3.6a1 1 0 0 1-.25 1z" />
            </svg>
            {b.phone}
          </span>
        )}
      </div>
    </header>
  )

  return <Paginated className="tm" header={header} side={side} main={main} />
}
