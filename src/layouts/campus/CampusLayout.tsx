import type { CSSProperties, ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Resume, Section } from '../../model/types'
import { SECTION_ICONS } from '../icons'
import { detailRows, entryPieces, withHeading } from '../kit'
import { Paginated, type Unit } from '../Paginated'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './campus.css'

/** Section colours: text/tab colour and a solid 12% tint for the date stickers. */
const COLOURS = [
  { c: '#5b4bdb', t: '#ebe9fb' },
  { c: '#b84408', t: '#f7e9e1' },
  { c: '#2b7a3e', t: '#e6efe8' },
  { c: '#1864ab', t: '#e3ecf5' },
  { c: '#b8205b', t: '#f7e4eb' },
]
const P = 'lx-campus'

const Squiggle = () => (
  <svg className={`${P}-squiggle`} viewBox="0 0 120 6" preserveAspectRatio="none" aria-hidden>
    <path
      d="M1 3.4 C6 0.6 9 0.6 13 3.2 S20 5.8 25 3.2 S32 0.6 37 3.2 S44 5.8 49 3.2 S56 0.6 61 3.2 S68 5.8 73 3.2 S80 0.6 85 3.2 S92 5.8 97 3.2 S104 0.6 109 3.2 S116 4.6 119 3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  </svg>
)

function Heading({ sec }: { sec: Section }) {
  const icon = sec.icon && sec.icon !== 'none' ? SECTION_ICONS[sec.icon] : null
  return (
    <div className={`${P}-head`}>
      <h2 className={`${P}-tab`}>
        {icon && <span className={`${P}-ico`} aria-hidden>{icon}</span>}
        {sec.title}
      </h2>
    </div>
  )
}

function entryHead(en: Entry, job: boolean): ReactNode {
  const dates = entryDates(en)
  return (
    <div className={`${P}-entry`}>
      <div className={`${P}-entry-top`}>
        <h3 className={`${P}-title`}>
          {en.title || en.organisation}
          {en.title && en.organisation && <span className={`${P}-org`}>{job ? ' at ' : ', '}{en.organisation}</span>}
        </h3>
        {dates && <span className={`${P}-date`}>{dates}</span>}
      </div>
      {en.location && <div className={`${P}-loc`}>{en.location}</div>}
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </div>
  )
}

function nodesOf(sec: Section, b: Basics): ReactNode[] {
  switch (sec.kind) {
    case 'details': {
      const rows = detailRows(b)
      return rows.length
        ? [
            <div key="d">
              {rows.map((r) => (
                <div key={r.label} className={`${P}-detail`}>
                  <div className={`${P}-label`}>{r.label}</div>
                  {r.lines.map((l, i) => <div key={i} className={`${P}-value`}>{l}</div>)}
                </div>
              ))}
            </div>,
          ]
        : []
    }
    case 'text':
      return paragraphs(sec.text, `${P}-text`)
    case 'entries':
      return sec.items.flatMap((en) => entryPieces(en, P, entryHead(en, sec.job)))
    case 'levels':
      return sec.items.map((l) => (
        <div key={l.id} className={`${P}-level`}>
          <span className={`${P}-level-name`}>{l.name}</span>
          <span className={`${P}-dots`} role="img" aria-label={`${l.level} of 5`}>
            {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= l.level ? 'on' : ''} />)}
          </span>
        </div>
      ))
    case 'links':
      return sec.items.map((l) => (
        <div key={l.id} className={`${P}-linkrow`}><a className={`${P}-link`} href={l.url}>{l.label || l.url}</a></div>
      ))
  }
}

export function CampusLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  let idx = 0
  const build = (secs: Section[]): Unit[] =>
    secs.flatMap((sec) => {
      const nodes = nodesOf(sec, b)
      if (!nodes.length) return []
      const col = COLOURS[idx++ % COLOURS.length]
      const style = { '--c': col.c, '--t': col.t } as CSSProperties
      return withHeading(sec.id, <Heading sec={sec} />, nodes, 'section').map((u) => ({
        ...u,
        node: <div className={`${P}-sec`} style={style}>{u.node}</div>,
      }))
    })
  const side = build(zoneSections(r, 'side'))
  const main = build(zoneSections(r, 'main'))

  const contact = [b.email, b.phone, locationLine(b)].filter(Boolean)
  const hasName = Boolean(b.firstName || b.lastName)
  const header = (
    <header className={`${P}-header`}>
      {hasName && <h1 className={`${P}-name`}>{[b.firstName, b.lastName].filter(Boolean).join(' ')}</h1>}
      {hasName && <Squiggle />}
      {b.headline && <div className={`${P}-headline`}>{b.headline}</div>}
      {contact.length > 0 && (
        <ul className={`${P}-contact`}>
          {contact.map((c, i) => (
            <li key={i}><i aria-hidden style={{ background: COLOURS[i % 5].c }} />{c}</li>
          ))}
        </ul>
      )}
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className={P} header={header} side={side} main={main} />
}
