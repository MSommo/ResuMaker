import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import { LEVEL_LABEL, type Basics, type Entry, type Leveled, type Resume, type Section } from '../../model/types'
import { Paginated, type Unit } from '../Paginated'
import { bodyPieces, detailRows, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './datasheet.css'

const P = 'lx-datasheet'

/** Section title as the solid black bar of a datasheet ("ABSOLUTE MAXIMUM RATINGS"). */
const Bar = ({ children }: { children: ReactNode }) => <h2 className={`${P}-bar`}>{children}</h2>

/** The tinted column-label row that opens an entries table. */
const ColHead = () => (
  <div className={`${P}-cols`} aria-hidden>
    <span>Role</span>
    <span>Period</span>
    <span>Note</span>
  </div>
)

/** One entry as table pieces: the spec row (never apart from its first body piece), then full-width body rows. */
function entryUnits(en: Entry): ReactNode[] {
  const dates = entryDates(en)
  const body = bodyPieces(en, P)
  const head = (
    <div className={`${P}-spec${body.length ? ` ${P}-spec-open` : ''}`}>
      <div className={`${P}-c1`}>
        <h3>{en.title}</h3>
        {en.organisation && <div className={`${P}-org`}>{en.organisation}</div>}
      </div>
      <div className={`${P}-c2`}>{dates}</div>
      <div className={`${P}-c3`}>
        {en.location && <div className={`${P}-loc`}>{en.location}</div>}
        {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
      </div>
    </div>
  )
  const wrapped = body.map((b, i) => <div key={i} className={`${P}-body`}>{b}</div>)
  const pieces = wrapped.length ? [<>{head}{wrapped[0]}</>, ...wrapped.slice(1)] : [head]
  return pieces.map((n, i) => (
    <div key={i} className={`${P}-row${i === pieces.length - 1 ? ` ${P}-row-last` : ''}`}>{n}</div>
  ))
}

const levelRow = (s: Leveled): ReactNode => {
  const lv = Math.min(5, Math.max(0, s.level))
  return (
    <div key={s.id} className={`${P}-row ${P}-row-last ${P}-level`} title={LEVEL_LABEL[lv]}>
      <span className={`${P}-lname`}>{s.name}</span>
      <span className={`${P}-boxes`} aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= lv ? `${P}-on` : undefined} />)}
      </span>
      <span className={`${P}-lnum`}>{lv}</span>
    </div>
  )
}

function details(b: Basics): ReactNode[] {
  return detailRows(b).map((r) => (
    <div key={r.label} className={`${P}-row ${P}-row-last ${P}-param`}>
      <span className={`${P}-pk`}>{r.label}</span>
      <span className={`${P}-pv`}>{r.lines.map((l, i) => <span key={i}>{l}</span>)}</span>
    </div>
  ))
}

function sectionUnits(sec: Section, b: Basics): Unit[] {
  let heading: ReactNode = <Bar>{sec.title}</Bar>
  const nodes: ReactNode[] = (() => {
    switch (sec.kind) {
      case 'details': return details(b)
      case 'text': {
        const ps = paragraphs(sec.text, `${P}-text`)
        return ps.map((p, i) => <div key={i} className={`${P}-row ${P}-boxed${i === ps.length - 1 ? ` ${P}-row-last` : ''}`}>{p}</div>)
      }
      case 'entries': {
        const items = sec.items.flatMap(entryUnits)
        if (items.length) heading = <><Bar>{sec.title}</Bar><ColHead /></>
        return items
      }
      case 'levels': return sec.items.map(levelRow)
      case 'links':
        return sec.items.map((l) => (
          <div key={l.id} className={`${P}-row ${P}-row-last ${P}-linkrow`}>
            <a href={l.url}>{l.label}</a>
          </div>
        ))
    }
  })()
  return nodes.length ? withHeading(sec.id, heading, nodes, 'section') : []
}

export function DatasheetLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, b))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, b))
  const loc = locationLine(b)
  const named = Boolean(b.firstName || b.lastName)
  const header = (
    <header className={`${P}-header`}>
      {(b.headline || loc) && (
        <div className={`${P}-strip`}>
          <span className={`${P}-strip-l`}>{b.headline}</span>
          {loc && <span className={`${P}-strip-r`}>{loc}</span>}
        </div>
      )}
      {named && (
        <>
          <h1 className={`${P}-name`}>
            {b.firstName} <span>{b.lastName}</span>
          </h1>
          <div className={`${P}-nrule`} aria-hidden />
        </>
      )}
      <HeaderExtras resume={r} />
    </header>
  )
  return <Paginated className={P} header={header} side={side} main={main} />
}
