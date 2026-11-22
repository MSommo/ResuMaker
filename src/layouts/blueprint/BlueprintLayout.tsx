import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Entry, Resume, Section } from '../../model/types'
import { SECTION_ICONS } from '../icons'
import { detailRows, entryPieces, levelPct, withHeading } from '../kit'
import type { Unit } from '../Paginated'
import { Paginated } from '../Paginated'
import { HeaderExtras, Rich, entryLine, paragraphs } from '../shared'
import './blueprint.css'

type Zone = 'side' | 'main'
const P = 'lx-blueprint'

/** Dimension-line heading for the main column; label tab for side boxes. */
function heading(sec: Section, zone: Zone): ReactNode {
  if (zone === 'side') return <h2 className={`${P}-tab`}>{sec.title}</h2>
  const icon = sec.icon !== 'none' ? SECTION_ICONS[sec.icon] : null
  return (
    <h2 className={`${P}-dim`}>
      <span className={`${P}-arrow ${P}-arrow-l`} aria-hidden />
      <span className={`${P}-dim-line`} aria-hidden />
      <span className={`${P}-dim-label`}>
        {icon && <span className={`${P}-icon`} aria-hidden>{icon}</span>}
        {sec.title}
      </span>
      <span className={`${P}-dim-line`} aria-hidden />
      <span className={`${P}-arrow ${P}-arrow-r`} aria-hidden />
    </h2>
  )
}

function entryHead(en: Entry, job: boolean): ReactNode {
  const dates = entryDates(en)
  const meta = [en.organisation, en.location].filter(Boolean).join(' · ')
  return (
    <div className={`${P}-head`}>
      {dates && <span className={`${P}-tag`}>{dates}</span>}
      <h3 className={`${P}-title`}>{en.title || entryLine(en, job)}</h3>
      {meta && <div className={`${P}-org`}>{meta}</div>}
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </div>
  )
}

function nodesFor(sec: Section, r: Resume): ReactNode[] {
  switch (sec.kind) {
    case 'details': {
      const rows = detailRows(r.basics)
      return rows.length
        ? [
            <dl key="d" className={`${P}-facts`}>
              {rows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  {row.lines.map((l, i) => <dd key={i}>{l}</dd>)}
                </div>
              ))}
            </dl>,
          ]
        : []
    }
    case 'text':
      return paragraphs(sec.text, `${P}-text`)
    case 'levels':
      return sec.items.filter((s) => s.name).map((s) => (
        <div key={s.id} className={`${P}-level`}>
          <div className={`${P}-level-top`}>
            <span className={`${P}-level-name`}>{s.name}</span>
            <span className={`${P}-level-num`}>{s.level}/5</span>
          </div>
          <div className={`${P}-ruler`} role="img" aria-label={`${s.level} of 5`}>
            <i className={`${P}-ruler-fill`} style={{ width: `${levelPct(s.level)}%` }} />
            {[0, 1, 2, 3, 4, 5].map((t) => <i key={t} className={`${P}-tick`} style={{ left: `${t * 20}%` }} />)}
          </div>
        </div>
      ))
    case 'links':
      return sec.items.filter((l) => l.label || l.url).map((l) => (
        <div key={l.id} className={`${P}-linkrow`}>
          <a href={l.url}>{l.label || l.url}</a>
        </div>
      ))
    case 'entries':
      return sec.items.flatMap((en) => entryPieces(en, P, entryHead(en, sec.job)))
  }
}

function sectionUnits(sec: Section, r: Resume, zone: Zone): Unit[] {
  const nodes = nodesFor(sec, r)
  if (!nodes.length) return []
  const wrapped = nodes.map((n, i) =>
    zone === 'side' ? (
      <div key={i} className={`${P}-box${i === 0 ? ' is-first' : ''}${i === nodes.length - 1 ? ' is-last' : ''}`}>{n}</div>
    ) : n,
  )
  return withHeading(sec.id, heading(sec, zone), wrapped, 'section')
}

const Cell = ({ label, children, cls = '' }: { label: string; children: ReactNode; cls?: string }) => (
  <div className={`${P}-cell ${cls}`}>
    <div className={`${P}-label`}>{label}</div>
    <div className={`${P}-value`}>{children}</div>
  </div>
)

export function BlueprintLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const name = fullName(b)
  const location = locationLine(b)
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, r, 'side'))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, r, 'main'))

  const header = (
    <header className={`${P}-header`}>
      {(name || b.headline || b.email || b.phone || location) && (
      <div className={`${P}-block`}>
        <div className={`${P}-cell ${P}-cell-name`}>
          <div className={`${P}-label`}>Drawing title</div>
          <h1 className={`${P}-name`}>{name || ' '}</h1>
        </div>
        {b.headline && <Cell label="Role" cls={`${P}-cell-role`}>{b.headline}</Cell>}
        {(b.email || b.phone) && (
          <Cell label="Contact" cls={`${P}-cell-contact`}>
            {b.email && <div>{b.email}</div>}
            {b.phone && <div>{b.phone}</div>}
          </Cell>
        )}
        {location && <Cell label="Location" cls={`${P}-cell-loc`}>{location}</Cell>}
      </div>
      )}
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className={P} header={header} side={side} main={main} />
}
