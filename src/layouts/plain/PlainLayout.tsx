import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import { LEVEL_LABEL, type Basics, type Entry, type Resume, type Section } from '../../model/types'
import { Paginated, type Unit } from '../Paginated'
import { detailRows, entryPieces, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './plain.css'

const P = 'lx-plain'

const Heading = ({ children }: { children: ReactNode }) => (
  <div className={`${P}-heading`}>
    <h2>{children}</h2>
    <div className={`${P}-rule`} aria-hidden="true" />
  </div>
)

function entry(en: Entry, job: boolean): ReactNode[] {
  // A job reads "Role" with the organisation beneath; anything else reads "Title" with the organisation beneath too.
  const title = en.title || en.organisation
  const org = en.title ? en.organisation : ''
  const sub = [org, en.location].filter(Boolean).join(', ')
  void job
  const dates = entryDates(en)
  const head = (
    <>
      <div className={`${P}-line`}>
        <h3>{title}</h3>
        {dates && <span className={`${P}-dates`}>{dates}</span>}
      </div>
      {sub && <div className={`${P}-sub-line`}>{sub}</div>}
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </>
  )
  return entryPieces(en, P, head)
}

function sectionNodes(sec: Section, b: Basics): ReactNode[] {
  switch (sec.kind) {
    case 'details': {
      const rows = detailRows(b)
      return rows.length
        ? [<div key="d">{rows.map((r) => <div key={r.label} className={`${P}-fact`}><b>{r.label}:</b> {r.lines.join(', ')}</div>)}</div>]
        : []
    }
    case 'text': return paragraphs(sec.text, `${P}-text`)
    case 'entries': return sec.items.flatMap((en) => entry(en, sec.job))
    case 'levels': {
      const items = sec.items.filter((l) => l.name.trim())
      return items.length
        ? [<p key="l" className={`${P}-run`}>{items.map((l, i) => (
            <span key={l.id}>{i > 0 && <span> · </span>}{l.name}{LEVEL_LABEL[l.level] && ` (${LEVEL_LABEL[l.level]})`}</span>
          ))}</p>]
        : []
    }
    case 'links': {
      const items = sec.items.filter((l) => l.url.trim() || l.label.trim())
      return items.map((l) => (
        <div key={l.id} className={`${P}-link`}>
          {l.label && <span>{l.label}: </span>}
          <a href={l.url}>{l.url}</a>
        </div>
      ))
    }
  }
}

function sectionUnits(sec: Section, b: Basics): Unit[] {
  const nodes = sectionNodes(sec, b)
  return nodes.length ? withHeading(sec.id, <Heading>{sec.title}</Heading>, nodes, 'section') : []
}

export function PlainLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const units = [...zoneSections(r, 'main'), ...zoneSections(r, 'side')].flatMap((s) => sectionUnits(s, b))
  const name = [b.firstName, b.lastName].filter(Boolean).join(' ')
  const contact = [locationLine(b), b.phone, b.email].filter(Boolean)

  const header = (
    <header className={`${P}-header`}>
      {name && <h1>{name}</h1>}
      {b.headline && <div className={`${P}-headline`}>{b.headline}</div>}
      {contact.length > 0 && <div className={`${P}-contact`}>{contact.join(' | ')}</div>}
      {(name || b.headline || contact.length > 0) && <div className={`${P}-rule ${P}-rule-top`} aria-hidden="true" />}
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className={P} header={header} side={[]} main={units} />
}
