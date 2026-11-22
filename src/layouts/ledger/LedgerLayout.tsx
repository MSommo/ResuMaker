import type { ReactNode } from 'react'
import { entryDates, formatMonth } from '../../model/dates'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Leveled, Resume, Section } from '../../model/types'
import { SECTION_ICONS } from '../icons'
import { Paginated, type Unit } from '../Paginated'
import { detailRows, entryPieces, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './ledger.css'

const P = 'lx-ledger'

/** Five squares, filled up to the level; the number is always printed next to them. */
const Squares = ({ level }: { level: number }) => {
  const n = Math.min(5, Math.max(0, Math.round(level)))
  return (
    <span className="lx-ledger-sq" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}
    </span>
  )
}

const levelRow = (s: Leveled) => (
  <div key={s.id} className="lx-ledger-level">
    <span className="lx-ledger-level-name">{s.name}</span>
    <Squares level={s.level} />
    <span className="lx-ledger-num">{Math.min(5, Math.max(0, s.level))}/5</span>
  </div>
)

function entryUnits(en: Entry, first: boolean, wide: boolean): ReactNode[] {
  const end = en.current ? 'Present' : formatMonth(en.end)
  const start = formatMonth(en.start)
  const dates = wide ? (
    (start || end) && (
      <div className="lx-ledger-dates">
        {start && <span>{start}</span>}
        {end && <span>{end}</span>}
      </div>
    )
  ) : (
    entryDates(en) && <div className="lx-ledger-dates">{entryDates(en)}</div>
  )
  const head = (
    <>
      <div className={`lx-ledger-rowrule${first ? ' first' : ''}`} aria-hidden />
      <div className="lx-ledger-row">
        {dates || <div />}
        <div className="lx-ledger-what">
          {en.title && <h3 className="lx-ledger-title">{en.title}</h3>}
          {en.organisation && <div className="lx-ledger-org">{en.organisation}</div>}
        </div>
        {en.location && <div className="lx-ledger-loc">{en.location}</div>}
      </div>
      {en.note && <div className="lx-ledger-note"><Rich text={en.note} /></div>}
    </>
  )
  return entryPieces(en, P, head)
}

function details(b: Basics): ReactNode {
  return (
    <div className="lx-ledger-kv">
      {detailRows(b).map((r) => (
        <div key={r.label} className="lx-ledger-kv-row">
          <div className="lx-ledger-k">{r.label}</div>
          <div className="lx-ledger-v">{r.lines.map((l, i) => <div key={i}>{l}</div>)}</div>
        </div>
      ))}
    </div>
  )
}

function sectionUnits(sec: Section, b: Basics, wide: boolean): Unit[] {
  const nodes: ReactNode[] = (() => {
    switch (sec.kind) {
      case 'details': return detailRows(b).length ? [details(b)] : []
      case 'text': return paragraphs(sec.text, 'lx-ledger-text')
      case 'entries': return sec.items.flatMap((en, i) => entryUnits(en, i === 0, wide))
      case 'levels': return sec.items.map(levelRow)
      case 'links':
        return sec.items.map((l) => (
          <div key={l.id} className="lx-ledger-linkrow"><a className="lx-ledger-link" href={l.url}>{l.label}</a></div>
        ))
    }
  })()
  if (!nodes.length) return []
  const showIcon = sec.icon !== 'none' && SECTION_ICONS[sec.icon]
  const heading = (
    <div className="lx-ledger-head">
      {showIcon ? <span className="lx-ledger-icon" aria-hidden>{SECTION_ICONS[sec.icon]}</span> : <span className="lx-ledger-mark" aria-hidden />}
      <h2 className="lx-ledger-h">{sec.title}</h2>
      <span className="lx-ledger-hline" aria-hidden />
    </div>
  )
  return withHeading(sec.id, heading, nodes, 'section')
}

export function LedgerLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, b, false))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, b, true))
  const name = fullName(b)
  const table = [['Phone', b.phone], ['Email', b.email], ['Location', locationLine(b)]].filter(([, v]) => v)
  const hasExtras = zoneSections(r, 'header').length > 0
  const header = (
    <header className="lx-ledger-header">
      {(name || b.headline || table.length > 0) && (
        <>
          <div className="lx-ledger-top">
            <div className="lx-ledger-id">
              {name && <h1 className="lx-ledger-name">{name}</h1>}
              {b.headline && <div className="lx-ledger-headline">{b.headline}</div>}
            </div>
            {table.length > 0 && (
              <div className="lx-ledger-table">
                {table.map(([k, v]) => (
                  <div key={k} className="lx-ledger-trow">
                    <span className="lx-ledger-tk">{k}</span>
                    <span className="lx-ledger-tv">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="lx-ledger-rule" aria-hidden />
        </>
      )}
      {hasExtras && <HeaderExtras resume={r} />}
    </header>
  )
  return <Paginated className="lx-ledger" header={header} side={side} main={main} />
}
