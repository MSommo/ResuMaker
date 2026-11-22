import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Leveled, LinkItem, Resume, Section } from '../../model/types'
import { Paginated, type Unit } from '../Paginated'
import { detailRows, entryPieces as buildEntryPieces, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './editorial.css'

const P = 'lx-editorial'

const Rule = ({ className }: { className: string }) => <div className={`${P}-r ${className}`} aria-hidden />

function entryPieces(en: Entry): ReactNode[] {
  const dates = entryDates(en)
  const head = (
    <>
      <h3 className={`${P}-title`}>{en.title || en.organisation}</h3>
      {(en.title && en.organisation) || dates || en.location ? (
        <div className={`${P}-meta`}>
          {en.title && en.organisation && <span className={`${P}-org`}>{en.organisation}</span>}
          {(dates || en.location) && (
            <span className={`${P}-when`}>
              {dates && <span className={`${P}-dates`}>{dates}</span>}
              {en.location && <span className={`${P}-loc`}>{en.location}</span>}
            </span>
          )}
        </div>
      ) : null}
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </>
  )
  return buildEntryPieces(en, P, head)
}

const levelRow = (s: Leveled) => {
  const lvl = Math.min(5, Math.max(1, s.level))
  return (
    <div key={s.id} className={`${P}-level`}>
      <div className={`${P}-level-name`}>{s.name}</div>
      <div className={`${P}-slider`} role="img" aria-label={`${s.name}: ${s.level} of 5`}>
        <span className={`${P}-r`} style={{ left: `calc((100% - 2.8mm) * ${(lvl - 1) / 4})` }} />
      </div>
    </div>
  )
}

const linkRow = (l: LinkItem) => (
  <a key={l.id} className={`${P}-link`} href={l.url}>{l.label || l.url}</a>
)

function details(b: Basics): ReactNode {
  return (
    <dl className={`${P}-facts`}>
      {detailRows(b).map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          {r.lines.map((l, i) => <dd key={i}>{l}</dd>)}
        </div>
      ))}
    </dl>
  )
}

function sectionUnits(sec: Section, b: Basics, zone: 'side' | 'main'): Unit[] {
  const nodes: ReactNode[] = (() => {
    switch (sec.kind) {
      case 'details': return detailRows(b).length ? [details(b)] : []
      case 'text': return paragraphs(sec.text, `${P}-text`)
      case 'entries': return sec.items.flatMap(entryPieces)
      case 'levels': return sec.items.map(levelRow)
      case 'links': return sec.items.map(linkRow)
    }
  })()
  if (!nodes.length) return []
  const heading = zone === 'side'
    ? <h2 className={`${P}-label`}>{sec.title}</h2>
    : <><Rule className={`${P}-r-top`} /><h2 className={`${P}-h`}>{sec.title}</h2></>
  const units = withHeading(sec.id, heading, nodes, 'section')
  // The fact box is drawn unit by unit: the first unit opens it, the last closes it.
  if (zone === 'side') {
    return units.map((u, i) => ({
      ...u,
      node: <div className={`${P}-box${i === 0 ? ' is-first' : ''}${i === units.length - 1 ? ' is-last' : ''}`}>{u.node}</div>,
    }))
  }
  return units
}

export function EditorialLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, b, 'side'))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, b, 'main'))

  const name = fullName(b)
  const dateline = [b.headline, locationLine(b), b.phone, b.email].filter(Boolean)
  const header = (
    <header className={`${P}-header`}>
      {(name || dateline.length > 0) && (
        <div className={`${P}-triple`} aria-hidden>
          <i className={`${P}-r`} /><i className={`${P}-r`} />
        </div>
      )}
      {name && <h1 className={`${P}-name`}>{name}</h1>}
      {dateline.length > 0 && (
        <div className={`${P}-dateline`}>
          <Rule className={`${P}-r-hair`} />
          <p>
            {dateline.map((d, i) => (
              <span key={i}>{i > 0 && <b aria-hidden> • </b>}{d}</span>
            ))}
          </p>
          <Rule className={`${P}-r-hair`} />
        </div>
      )}
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className={side.length ? P : `${P} ${P}-no-side`} header={header} side={side} main={main} />
}
