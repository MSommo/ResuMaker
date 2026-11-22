import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Resume, Section } from '../../model/types'
import { SECTION_ICONS } from '../icons'
import { Paginated, type Unit } from '../Paginated'
import { detailRows, entryPieces, levelPct, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './billboard.css'

const P = 'lx-billboard'

function Heading({ sec }: { sec: Section }) {
  const icon = sec.icon !== 'none' ? SECTION_ICONS[sec.icon] : null
  return (
    <div className={`${P}-h`}>
      {icon && <span className={`${P}-icon`} aria-hidden>{icon}</span>}
      <h2>{sec.title}</h2>
    </div>
  )
}

function entryHead(en: Entry, job: boolean): ReactNode {
  const dates = entryDates(en)
  const title = job ? (en.title && en.organisation ? `${en.title} at ${en.organisation}` : en.title || en.organisation) : en.title
  const org = job ? '' : en.organisation
  return (
    <>
      <div className={`${P}-eh`}>
        <h3 className={`${P}-title`}>{title}{org && <span className={`${P}-org`}>{title ? ', ' : ''}{org}</span>}</h3>
        {en.location && <span className={`${P}-loc`}>{en.location}</span>}
      </div>
      {dates && <div className={`${P}-dates`}><i aria-hidden="true" /><span>{dates}</span></div>}
      {en.note && <div className={`${P}-note`}><span><Rich text={en.note} /></span></div>}
    </>
  )
}

function sectionUnits(sec: Section, b: Basics, end: Unit['end']): Unit[] {
  const nodes: ReactNode[] = (() => {
    switch (sec.kind) {
      case 'details':
        return detailRows(b).length
          ? [<dl key="d" className={`${P}-details`}>{detailRows(b).map((r) => (
              <div key={r.label}><dt>{r.label}</dt>{r.lines.map((l, i) => <dd key={i}>{l}</dd>)}</div>
            ))}</dl>]
          : []
      case 'text': return paragraphs(sec.text, `${P}-text`)
      case 'entries': return sec.items.flatMap((en) => entryPieces(en, P, entryHead(en, sec.job)))
      case 'levels':
        return sec.items.map((s) => (
          <div key={s.id} className={`${P}-level`}>
            <div className={`${P}-level-name`}>{s.name}</div>
            <div className={`${P}-segs`} role="img" aria-label={`${s.level} of 5`}>
              {[1, 2, 3, 4, 5].map((i) => <i key={i} className={levelPct(s.level) >= i * 20 ? 'on' : ''} />)}
            </div>
          </div>
        ))
      case 'links':
        return sec.items.map((l) => <a key={l.id} className={`${P}-link`} href={l.url}>{l.label}</a>)
    }
  })()
  return nodes.length ? withHeading(sec.id, <Heading sec={sec} />, nodes, end) : []
}

export function BillboardLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, b, 'section'))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, b, 'section'))
  const contact = [b.email, b.phone, locationLine(b)].filter(Boolean)

  const header = (
    <header className={`${P}-header`}>
      {fullName(b) && <h1 className={`${P}-name`}>{b.firstName} {b.lastName}</h1>}
      {b.headline && <div className={`${P}-headline`}><span>{b.headline}</span></div>}
      {contact.length > 0 && <ul className={`${P}-contact`}>{contact.map((c) => <li key={c}>{c}</li>)}</ul>}
      <HeaderExtras resume={r} />
    </header>
  )
  return <Paginated className={P} header={header} side={side} main={main} />
}
