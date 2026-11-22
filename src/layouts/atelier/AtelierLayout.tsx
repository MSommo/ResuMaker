import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Leveled, Resume, Section } from '../../model/types'
import { Paginated, type Unit } from '../Paginated'
import { detailRows, entryPieces, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './atelier.css'

const P = 'lx-atelier'

const Heading = ({ children }: { children: ReactNode }) => (
  <h2 className={`${P}-heading`}>
    <span className={`${P}-dot`} aria-hidden />
    {children}
  </h2>
)

const Dots = ({ level }: { level: number }) => (
  <span className={`${P}-dots`} role="img" aria-label={`${level} of 5`}>
    {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= level ? `${P}-dot-on` : `${P}-dot-off`} />)}
  </span>
)

const levelRow = (s: Leveled) => (
  <div key={s.id} className={`${P}-level`}>
    <span className={`${P}-level-name`}>{s.name}</span>
    <Dots level={s.level} />
  </div>
)

function entry(en: Entry): ReactNode[] {
  const dates = entryDates(en)
  const head = (
    <>
      {dates && <div className={`${P}-dates`}>{dates}</div>}
      <h3 className={`${P}-title`}>{en.title || en.organisation}</h3>
      {(en.title && en.organisation) || en.location ? (
        <div className={`${P}-org`}>
          {en.title && en.organisation && <span className={`${P}-orgname`}>{en.organisation}</span>}
          {en.title && en.organisation && en.location && <span aria-hidden> · </span>}
          {en.location && <span>{en.location}</span>}
        </div>
      ) : null}
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </>
  )
  return entryPieces(en, P, head)
}

function details(b: Basics): ReactNode {
  return (
    <div>
      {detailRows(b).map((r) => (
        <div key={r.label} className={`${P}-detail`}>
          <div className={`${P}-label`}>{r.label}</div>
          {r.lines.map((l, i) => <div key={i} className={`${P}-value`}>{l}</div>)}
        </div>
      ))}
    </div>
  )
}

function sectionUnits(sec: Section, b: Basics): Unit[] {
  const nodes: ReactNode[] = (() => {
    switch (sec.kind) {
      case 'details': return detailRows(b).length ? [details(b)] : []
      case 'text': return paragraphs(sec.text, `${P}-text`)
      case 'entries': return sec.items.flatMap(entry)
      case 'levels': return sec.items.map(levelRow)
      case 'links': return sec.items.map((l) => <a key={l.id} className={`${P}-link`} href={l.url}>{l.label}</a>)
    }
  })()
  return nodes.length ? withHeading(sec.id, <Heading>{sec.title}</Heading>, nodes, 'section') : []
}

export function AtelierLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, b))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, b))
  const contact = [b.email, b.phone, locationLine(b)].filter(Boolean)

  const header = (
    <header className={`${P}-header`}>
      {(b.firstName || b.lastName) && (
        <h1 className={`${P}-name`}>
          <span className={`${P}-first`}>
            <span className={`${P}-circle`} aria-hidden />
            {b.firstName}
          </span>
          {b.lastName && <span className={`${P}-last`}>{b.lastName}</span>}
        </h1>
      )}
      {b.headline && <div className={`${P}-headline`}>{b.headline}</div>}
      {contact.length > 0 && (
        <div className={`${P}-contact`}>
          {contact.map((c, i) => <span key={i}>{c}</span>)}
        </div>
      )}
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className={P} header={header} side={side} main={main} />
}
