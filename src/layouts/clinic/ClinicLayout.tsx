import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import { LEVEL_LABEL, type Basics, type Resume, type Section } from '../../model/types'
import { Paginated, type Unit } from '../Paginated'
import { SECTION_ICONS } from '../icons'
import { detailRows, entryPieces, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './clinic.css'

const P = 'lx-clinic'
type Zone = 'side' | 'main'

const initials = (b: Basics) =>
  [b.firstName, b.lastName].map((s) => s.trim().charAt(0)).join('').toUpperCase()

const Level = ({ level, name }: { level: number; name: string }) => (
  <div className={`${P}-level`}>
    <div className={`${P}-level-name`}>{name}</div>
    <div className={`${P}-track`} role="img" aria-label={`${LEVEL_LABEL[level] ?? ''} (${level} of 5)`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= level ? 'on' : undefined} />)}
    </div>
  </div>
)

function heading(sec: Section, zone: Zone): ReactNode {
  if (zone === 'side') return <h2 className={`${P}-pill`}>{sec.title}</h2>
  return (
    <h2 className={`${P}-h`}>
      <span className={`${P}-bar`} aria-hidden />
      {sec.icon !== 'none' && <span className={`${P}-icon`} aria-hidden>{SECTION_ICONS[sec.icon]}</span>}
      {sec.title}
    </h2>
  )
}

function sectionUnits(sec: Section, b: Basics, zone: Zone): Unit[] {
  const nodes: ReactNode[] = (() => {
    switch (sec.kind) {
      case 'details':
        return detailRows(b).map((r) => (
          <div key={r.label} className={`${P}-detail`}>
            <div className={`${P}-label`}>{r.label}</div>
            {r.lines.map((l, i) => <div key={i} className={`${P}-value`}>{l}</div>)}
          </div>
        ))
      case 'text':
        return paragraphs(sec.text, `${P}-text`)
      case 'entries':
        return sec.items.flatMap((en) => {
          const dates = entryDates(en)
          const head = (
            <>
              {en.title && <h3 className={`${P}-title`}>{en.title}</h3>}
              {(en.organisation || en.location) && (
                <div className={`${P}-org`}>
                  {en.organisation && <span className={`${P}-orgname`}>{en.organisation}</span>}
                  {en.location && <span className={`${P}-loc`}>{en.location}</span>}
                </div>
              )}
              {dates && <div><span className={`${P}-dates`}>{dates}</span></div>}
              {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
            </>
          )
          return entryPieces(en, P, head)
        })
      case 'levels':
        return sec.items.map((l) => <Level key={l.id} level={l.level} name={l.name} />)
      case 'links':
        return sec.items.map((l) => <a key={l.id} className={`${P}-link`} href={l.url}>{l.label}</a>)
    }
  })()
  if (!nodes.length) return []
  const h = heading(sec, zone)
  if (zone === 'main') return withHeading(sec.id, h, nodes, 'section')
  // Side sections sit on a rounded card that continues across units (and pages): round only its first and last unit.
  const n = nodes.length
  const cards = nodes.map((node, i) => (
    <div key={i} className={`${P}-card${i === 0 ? ' first' : ''}${i === n - 1 ? ' last' : ''}`}>
      {i === 0 && h}
      {node}
    </div>
  ))
  return withHeading(sec.id, null, cards, 'section')
}

export function ClinicLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, b, 'side'))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, b, 'main'))
  const name = fullName(b)
  const pills = [b.email, b.phone, locationLine(b)].filter(Boolean)

  const header = (
    <header className={`${P}-header`}>
      <div className={`${P}-top`}>
        <div className={`${P}-id`}>
          {name && <h1>{name}</h1>}
          {b.headline && <div className={`${P}-headline`}>{b.headline}</div>}
        </div>
        {name && <div className={`${P}-badge`} aria-hidden>{initials(b)}</div>}
      </div>
      {pills.length > 0 && <ul className={`${P}-pills`}>{pills.map((p) => <li key={p}>{p}</li>)}</ul>}
      <HeaderExtras resume={r} />
      {(name || b.headline || pills.length > 0) && <div className={`${P}-rule`} aria-hidden />}
    </header>
  )

  return <Paginated className={P} header={header} side={side} main={main} />
}
