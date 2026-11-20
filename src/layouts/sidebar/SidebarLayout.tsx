import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { addressLines, birthLines } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Leveled, Resume, Section } from '../../model/types'
import { Paginated, type Unit } from '../Paginated'
import { HeaderExtras, Rich, paragraphs, parseBullets } from '../shared'
import './sidebar.css'

const Heading = ({ children }: { children: ReactNode }) => <h2 className="sb-heading">{children}</h2>

const Bar = ({ level }: { level: number }) => (
  <div className="sb-bar">
    <div style={{ width: `${(Math.min(5, Math.max(0, level)) / 5) * 100}%` }} />
  </div>
)

/**
 * An entry as several pieces so it can break across pages between paragraphs/bullets.
 * The head always travels with the piece that follows it, and the last piece carries the entry spacing.
 */
function entryPieces(en: Entry): ReactNode[] {
  const org = [en.title, en.organisation].filter(Boolean).join(', ')
  const dates = entryDates(en)
  const head = (
    <>
      <div className="sb-entry-head">
        <h3>{org}</h3>
        {en.location && <span className="sb-loc">{en.location}</span>}
      </div>
      {dates && <div className="sb-dates">{dates}</div>}
      {en.note && <div className="sb-note"><Rich text={en.note} /></div>}
    </>
  )
  const body: ReactNode[] = en.description ? paragraphs(en.description, 'sb-text') : []
  // A subheading travels with the first bullet after it, so it is never stranded at a page bottom.
  let pending: ReactNode = null
  parseBullets(en.bullets).forEach((b, i) => {
    if (b.type === 'heading') {
      if (pending) body.push(pending)
      pending = (
        <div key={`h${i}`} className="sb-sub">
          <Rich text={b.text} />
        </div>
      )
    } else {
      body.push(
        <div key={`b${i}`}>
          {pending}
          <ul className="sb-bullets">
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
  const pieces = body.length ? [<div key="h">{head}{body[0]}</div>, ...body.slice(1)] : [head]
  return pieces.map((node, i) => (
    <div key={i} className={i === pieces.length - 1 ? 'sb-entry-end' : undefined}>
      {node}
    </div>
  ))
}

/** Heading goes with the first item so a section title is never stranded at a page bottom. */
function section(key: string, title: string, items: ReactNode[], end: Unit['end']): Unit[] {
  return items.map((node, i) => ({
    key: `${key}-${i}`,
    section: key,
    node: i === 0 ? (
      <>
        <Heading>{title}</Heading>
        {node}
      </>
    ) : (
      node
    ),
    end: i === items.length - 1 ? end : undefined,
  }))
}

const levelRow = (s: Leveled) => (
  <div key={s.id} className="sb-level">
    <div className="sb-level-name">{s.name}</div>
    <Bar level={s.level} />
  </div>
)

function details(b: Basics): ReactNode {
  const row = (label: string, lines: string[]) =>
    lines.length > 0 && (
      <div className="sb-detail" key={label}>
        <div className="sb-label">{label}</div>
        {lines.map((l, i) => (
          <div key={i} className="sb-value">
            {l}
          </div>
        ))}
      </div>
    )
  return (
    <>
      {row('Address', addressLines(b))}
      {row('Phone', [b.phone].filter(Boolean))}
      {row('Email', [b.email].filter(Boolean))}
      {row('Date / place of birth', birthLines(b))}
      {row('Nationality', [b.nationality].filter(Boolean))}
    </>
  )
}

function sectionUnits(sec: Section, b: Basics, end: Unit['end']): Unit[] {
  const nodes: ReactNode[] = (() => {
    switch (sec.kind) {
      case 'details': return [details(b)]
      case 'text': return paragraphs(sec.text, 'sb-text')
      case 'entries': return sec.items.flatMap(entryPieces)
      case 'levels': return sec.items.map(levelRow)
      case 'links':
        return sec.items.map((l) => (
          <a key={l.id} className="sb-link" href={l.url}>
            {l.label}
          </a>
        ))
    }
  })()
  return nodes.length ? section(sec.id, sec.title, nodes, end) : []
}

export function SidebarLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, b, 'section'))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, b, 'rule'))
  // No rule under the very last block.
  if (main.length) main[main.length - 1] = { ...main[main.length - 1], end: 'section' }

  const header = (
    <header className="sb-header">
      <h1>
        {b.firstName} <br />
        {b.lastName}
      </h1>
      {b.headline && <div className="sb-headline">{b.headline}</div>}
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className="sb" header={header} side={side} main={main} />
}
