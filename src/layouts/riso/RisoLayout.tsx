import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Resume, Section } from '../../model/types'
import { SECTION_ICONS } from '../icons'
import { Paginated, type Unit } from '../Paginated'
import { detailRows, entryPieces, levelPct } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './riso.css'

const P = 'lx-riso'

type Zone = 'side' | 'main'

function Heading({ sec }: { sec: Section }) {
  return (
    <h2 className={`${P}-h`}>
      <span className={`${P}-pill`}>
        <span className={`${P}-pill-bg`} aria-hidden />
        <span className={`${P}-pill-txt`}>
          {sec.icon !== 'none' && <span className={`${P}-ico`} aria-hidden>{SECTION_ICONS[sec.icon]}</span>}
          {sec.title}
        </span>
        <span className={`${P}-pill-txt ${P}-pill-tail`} aria-hidden>
          {sec.icon !== 'none' && <span className={`${P}-ico`}>{SECTION_ICONS[sec.icon]}</span>}
          {sec.title}
        </span>
      </span>
    </h2>
  )
}

function Dots({ level }: { level: number }) {
  const n = Math.round(levelPct(level) / 20)
  return (
    <span className={`${P}-dots`} aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}
    </span>
  )
}

function entryHead(en: Entry): ReactNode {
  const dates = entryDates(en)
  return (
    <>
      {dates && <div className={`${P}-dates`}>{dates}</div>}
      {en.title && <h3 className={`${P}-title`}>{en.title}</h3>}
      {(en.organisation || en.location) && (
        <div className={`${P}-org`}>
          {en.organisation && <b>{en.organisation}</b>}
          {en.organisation && en.location && <span className={`${P}-sep`} aria-hidden> / </span>}
          {en.location && <span className={`${P}-loc`}>{en.location}</span>}
        </div>
      )}
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </>
  )
}

function nodesOf(sec: Section, b: Basics): ReactNode[] {
  switch (sec.kind) {
    case 'details': {
      const rows = detailRows(b)
      return rows.length
        ? [
            <dl key="d" className={`${P}-facts`}>
              {rows.map((r) => (
                <div key={r.label}>
                  <dt>{r.label}</dt>
                  {r.lines.map((l, i) => <dd key={i}>{l}</dd>)}
                </div>
              ))}
            </dl>,
          ]
        : []
    }
    case 'text': return paragraphs(sec.text, `${P}-text`)
    case 'entries': return sec.items.flatMap((en) => entryPieces(en, P, entryHead(en)))
    case 'levels':
      return sec.items.map((l) => (
        <div key={l.id} className={`${P}-level`}>
          <span className={`${P}-level-name`}>{l.name}</span>
          <Dots level={l.level} />
          <span className={`${P}-sr`}>{l.level} of 5</span>
        </div>
      ))
    case 'links':
      return sec.items.map((l) => (
        <div key={l.id} className={`${P}-linkrow`}>
          <a className={`${P}-link`} href={l.url}>{l.label || l.url}</a>
        </div>
      ))
  }
}

function sectionUnits(sec: Section, b: Basics, zone: Zone): Unit[] {
  const nodes = nodesOf(sec, b)
  return nodes.map((node, i) => {
    const first = i === 0
    const last = i === nodes.length - 1
    const inner = first ? <><Heading sec={sec} />{node}</> : node
    const wrapped = zone === 'side' ? (
      <div className={`${P}-panel${first ? ' is-first' : ''}${last ? ' is-last' : ''}`}>
        <span className={`${P}-shadow`} aria-hidden />
        <span className={`${P}-shadow-b`} aria-hidden />
        <div className={`${P}-panel-in`}>{inner}</div>
      </div>
    ) : inner
    return { key: `${sec.id}-${i}`, section: sec.id, node: wrapped, end: last ? 'section' : undefined } satisfies Unit
  })
}

function Deco() {
  return (
    <div className={`${P}-deco`} aria-hidden>
      <div className={`${P}-halftone`} />
      <div className={`${P}-pink`} />
      <div className={`${P}-blue`} />
      <div className={`${P}-lens`}><div className={`${P}-purple`} /></div>
    </div>
  )
}

export function RisoLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, b, 'side'))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, b, 'main'))
  const contact = [b.email, b.phone, locationLine(b)].filter(Boolean)

  const header = (
    <header className={`${P}-header`}>
      <div className={`${P}-head-text`}>
        {fullName(b) && (
          <h1 className={`${P}-name`}>
            {b.firstName && <span>{b.firstName}</span>}{' '}
            {b.lastName && <span>{b.lastName}</span>}
          </h1>
        )}
        {b.headline && <div className={`${P}-headline`}>{b.headline}</div>}
        {contact.length > 0 && (
          <ul className={`${P}-contact`}>
            {contact.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
      </div>
      <Deco />
      <div className={`${P}-extras`}><HeaderExtras resume={r} /></div>
    </header>
  )

  return <Paginated className={P} header={header} side={side} main={main} />
}
