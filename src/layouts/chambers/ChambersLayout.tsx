import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import { LEVEL_LABEL, type Basics, type Entry, type Resume, type Section } from '../../model/types'
import type { Unit } from '../Paginated'
import { Paginated } from '../Paginated'
import { detailRows, entryPieces, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './chambers.css'

const P = 'lx-chambers'

const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
function roman(n: number): string {
  let out = ''
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v }
  return out
}

const Heading = ({ num, title }: { num: string; title: string }) => (
  <h2 className={`${P}-heading`}>
    <span className={`${P}-num`}>{num}.</span> {title}
  </h2>
)

function entry(en: Entry, job: boolean): ReactNode[] {
  const dates = entryDates(en)
  const title = job && en.organisation ? en.title : en.title || en.organisation
  const sub = (job && en.title ? [en.organisation, en.location] : [en.title && en.organisation ? en.organisation : '', en.location]).filter(Boolean).join(', ')
  const head = (
    <>
      <div className={`${P}-line`}>
        <h3 className={`${P}-title`}>{title}</h3>
        {dates && <><span className={`${P}-leader`} aria-hidden /><span className={`${P}-dates`}>{dates}</span></>}
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
        ? [<dl key="d" className={`${P}-facts`}>{rows.map((r) => <div key={r.label}><dt>{r.label}:</dt> <dd>{r.lines.join(', ')}</dd></div>)}</dl>]
        : []
    }
    case 'text': return sec.text.trim() ? paragraphs(sec.text, `${P}-text`) : []
    case 'entries': return sec.items.flatMap((en) => entry(en, sec.job))
    case 'levels': {
      const items = sec.items.filter((l) => l.name.trim())
      return items.length
        ? [<ul key="l" className={`${P}-runin`}>{items.map((l) => <li key={l.id}>{l.name}{LEVEL_LABEL[l.level] ? ` (${LEVEL_LABEL[l.level]})` : ''}</li>)}</ul>]
        : []
    }
    case 'links': {
      const items = sec.items.filter((l) => l.url.trim() || l.label.trim())
      return items.map((l) => (
        <div key={l.id} className={`${P}-link`}>
          {l.label && <>{l.label} </>}
          <a href={l.url}>{l.url ? `(${l.url.replace(/^https?:\/\//, '')})` : ''}</a>
        </div>
      ))
    }
  }
}

export function ChambersLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  // One column, main first: all sections in this order; numerals count only the sections that render.
  const secs = [...zoneSections(r, 'main'), ...zoneSections(r, 'side')]
  let n = 0
  const units: Unit[] = secs.flatMap((sec) => {
    const nodes = sectionNodes(sec, b)
    if (!nodes.length) return []
    n += 1
    return withHeading(sec.id, <Heading num={roman(n)} title={sec.title} />, nodes, 'section')
  })

  const name = fullName(b)
  const contact = [locationLine(b), b.phone, b.email].filter(Boolean)
  const header = (
    <header className={`${P}-header`}>
      {name && <h1 className={`${P}-name`}>{name}</h1>}
      {b.headline && <div className={`${P}-headline`}>{b.headline}</div>}
      {contact.length > 0 && <div className={`${P}-contact`}>{contact.map((c, i) => <span key={i}>{c}</span>)}</div>}
      {(name || b.headline || contact.length > 0) && (
        <div className={`${P}-double`} aria-hidden><i /><i /></div>
      )}
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className={P} header={header} side={[]} main={units} />
}
