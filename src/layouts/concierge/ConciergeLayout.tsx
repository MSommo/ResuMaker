import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Resume, Section } from '../../model/types'
import { SECTION_ICONS } from '../icons'
import type { Unit } from '../Paginated'
import { Paginated } from '../Paginated'
import { detailRows, entryPieces, levelPct, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './concierge.css'

const P = 'lx-concierge'

const Heading = ({ sec }: { sec: Section }) => (
  <div className={`${P}-heading`}>
    {sec.icon !== 'none' && <span className={`${P}-icon`} aria-hidden>{SECTION_ICONS[sec.icon]}</span>}
    <div className={`${P}-heading-row`}>
      <span className={`${P}-hr`} aria-hidden />
      <h2>{sec.title}</h2>
      <span className={`${P}-hr`} aria-hidden />
    </div>
  </div>
)

const Diamonds = ({ level }: { level: number }) => {
  const n = Math.round((levelPct(level) / 100) * 5)
  return (
    <span className={`${P}-dia`} role="img" aria-label={`${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : undefined} />)}
    </span>
  )
}

function entryNodes(en: Entry): ReactNode[] {
  const dates = entryDates(en)
  const head = (
    <div className={`${P}-head`}>
      <h3>{en.title}</h3>
      {(en.organisation || en.location) && (
        <div className={`${P}-org`}>
          {en.organisation && <span>{en.organisation}</span>}
          {en.organisation && en.location && <span className={`${P}-sep`} aria-hidden />}
          {en.location && <span className={`${P}-loc`}>{en.location}</span>}
        </div>
      )}
      {dates && <div className={`${P}-dates`}>{dates}</div>}
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </div>
  )
  return entryPieces(en, P, head)
}

function sectionUnits(sec: Section, b: Basics): Unit[] {
  const nodes: ReactNode[] = (() => {
    switch (sec.kind) {
      case 'details':
        return detailRows(b).length
          ? [
              <dl key="d" className={`${P}-details`}>
                {detailRows(b).map((r) => (
                  <div key={r.label}>
                    <dt>{r.label}</dt>
                    {r.lines.map((l, i) => <dd key={i}>{l}</dd>)}
                  </div>
                ))}
              </dl>,
            ]
          : []
      case 'text': return paragraphs(sec.text, `${P}-text`)
      case 'entries': return sec.items.flatMap((e) => entryNodes(e))
      case 'levels':
        return sec.items.map((s) => (
          <div key={s.id} className={`${P}-level`}>
            <span className={`${P}-level-name`}>{s.name}</span>
            <Diamonds level={s.level} />
          </div>
        ))
      case 'links':
        return sec.items.map((l) => (
          <div key={l.id} className={`${P}-linkrow`}><a className={`${P}-link`} href={l.url}>{l.label}</a></div>
        ))
    }
  })()
  return nodes.length ? withHeading(sec.id, <Heading sec={sec} />, nodes, 'section') : []
}

export function ConciergeLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const name = fullName(b)
  const contact = [b.email, b.phone, locationLine(b)].filter(Boolean)
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, b))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, b))

  const header = (
    <header className={`${P}-header`}>
      {name && <h1>{name}</h1>}
      {b.headline && <div className={`${P}-headline`}>{b.headline}</div>}
      {(name || b.headline) && (
        <div className={`${P}-orn`} aria-hidden>
          <span /><i /><span />
        </div>
      )}
      {contact.length > 0 && (
        <div className={`${P}-contact`}>
          {contact.map((c, i) => <span key={i}>{c}</span>)}
        </div>
      )}
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className={main.length ? P : `${P} ${P}-nomain`}header={header} side={side} main={main} />
}
