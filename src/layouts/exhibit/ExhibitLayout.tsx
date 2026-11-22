import type { ReactNode } from 'react'
import { formatMonth } from '../../model/dates'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Resume, Section } from '../../model/types'
import { SECTION_ICONS } from '../icons'
import { Paginated, type Unit } from '../Paginated'
import { detailRows, entryPieces, levelPct, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './exhibit.css'

const P = 'lx-exhibit'

/** Wall-label dates: `2022 — NOW`, `2016 — 2019`, or a single year. */
function labelDates(e: Pick<Entry, 'start' | 'end' | 'current'>): string {
  const yr = (v: string) => (/^\d{4}/.test(v) ? v.slice(0, 4) : formatMonth(v))
  const a = yr(e.start)
  const z = e.current ? 'Now' : yr(e.end)
  return [a, z].filter(Boolean).filter((v, i, all) => i === 0 || v !== all[0]).join(' — ')
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function Heading({ sec }: { sec: Section }) {
  const icon = sec.icon && sec.icon !== 'none' ? SECTION_ICONS[sec.icon] : null
  return (
    <div className={`${P}-sec`}>
      <div className={`${P}-rule`} aria-hidden />
      <h2 className={`${P}-h`}>
        {icon && <span className={`${P}-icon`} aria-hidden>{icon}</span>}
        <span className={`${P}-strip`}>{sec.title}</span>
      </h2>
    </div>
  )
}

function entryUnits(en: Entry, n: number, job: boolean): ReactNode[] {
  const dates = labelDates(en)
  // A job's title is the role; the organisation then goes to the caption lines. Otherwise fall back to whichever is filled.
  const title = en.title || en.organisation
  const where = [en.title ? en.organisation : '', en.location].filter(Boolean)
  void job
  const head = (
    <div className={`${P}-head`}>
      <div className={`${P}-tick`} aria-hidden />
      <div className={`${P}-idx`}>{pad2(n)}</div>
      <div className={`${P}-label`}>
        {title && <h3 className={`${P}-title`}>{title}</h3>}
        {where.map((w, i) => <div key={i} className={`${P}-cap`}>{w}</div>)}
        {dates && <div className={`${P}-cap ${P}-dates`}>{dates}</div>}
        {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
      </div>
    </div>
  )
  return entryPieces(en, P, head).map((node, i) => <div key={i} className={`${P}-ent`}>{node}</div>)
}

function detailsNode(b: Basics): ReactNode {
  return (
    <dl className={`${P}-facts`}>
      {detailRows(b).map((r) => (
        <div key={r.label} className={`${P}-fact`}>
          <dt className={`${P}-cap ${P}-k`}>{r.label}</dt>
          {r.lines.map((l, i) => <dd key={i} className={`${P}-cap ${P}-v`}>{l}</dd>)}
        </div>
      ))}
    </dl>
  )
}

function sectionUnits(sec: Section, b: Basics, end: Unit['end']): Unit[] {
  const nodes: ReactNode[] = (() => {
    switch (sec.kind) {
      case 'details': return detailRows(b).length ? [detailsNode(b)] : []
      case 'text': return sec.text.trim() ? paragraphs(sec.text, `${P}-text`) : []
      case 'entries': return sec.items.flatMap((e, i) => entryUnits(e, i + 1, sec.job))
      case 'levels':
        return sec.items.map((l) => (
          <div key={l.id} className={`${P}-level`}>
            <div className={`${P}-cap`}>{l.name}</div>
            <div className={`${P}-track`} role="img" aria-label={`${l.level} of 5`}>
              <div className={`${P}-line`} aria-hidden />
              <div className={`${P}-mark`} style={{ ['--p' as string]: levelPct(l.level) / 100 }} aria-hidden />
            </div>
          </div>
        ))
      case 'links':
        return sec.items.map((l) => (
          <div key={l.id} className={`${P}-linkrow`}>
            <a className={`${P}-link`} href={l.url}>{l.label || l.url}</a>
          </div>
        ))
    }
  })()
  return nodes.length ? withHeading(sec.id, <Heading sec={sec} />, nodes, end) : []
}

export function ExhibitLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, b, 'section'))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, b, 'section'))

  const longest = Math.max(b.firstName.length, b.lastName.length)
  const size = longest <= 9 ? 52 : longest <= 12 ? 44 : longest <= 16 ? 34 : 26
  const caps = [
    ['Email', b.email], ['Phone', b.phone], ['Based in', locationLine(b)],
  ].filter(([, v]) => v)
  const hasName = !!fullName(b)

  const header = (
    <header className={`${P}-header`}>
      {(hasName || b.headline) && (
        <div className={`${P}-top`}>
          <h1 className={`${P}-name`} style={{ fontSize: `${size}pt` }}>
            {b.firstName && <span className={`${P}-first`}>{b.firstName}</span>}
            {b.lastName && <span className={`${P}-last`}>{b.lastName}</span>}
          </h1>
          {b.headline && <p className={`${P}-headline`}>{b.headline}</p>}
        </div>
      )}
      {caps.length > 0 && (
        <div className={`${P}-caps`}>
          {caps.map(([k, v]) => (
            <div key={k} className={`${P}-capcell`}>
              <span className={`${P}-capk`}>{k}</span>
              <span className={`${P}-capv`}>{v}</span>
            </div>
          ))}
        </div>
      )}
      {(hasName || b.headline || caps.length > 0) && <div className={`${P}-hrule`} aria-hidden />}
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className={P} header={header} side={side} main={main} />
}
