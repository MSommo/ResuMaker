import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Entry, Resume, Section } from '../../model/types'
import { Paginated, type Unit } from '../Paginated'
import { bodyPieces, detailRows, levelPct } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './swiss.css'

const P = 'lx-swiss'

/** One grid row: a 40 mm label rail and the content. Units that continue a section keep an empty rail. */
function Row({ rail, children, opener, free }: { rail?: ReactNode; children?: ReactNode; opener?: ReactNode; free?: boolean }) {
  return (
    <div className={`${P}-row${opener ? ` ${P}-first` : ''}${free ? ` ${P}-free` : ''}`}>
      {opener}
      <div className={`${P}-rail`}>{rail}</div>
      <div className={`${P}-body`}>{children}</div>
    </div>
  )
}

/** The section number and title in the rail, for the first unit only. */
const Label = ({ n, title }: { n: number; title: string }) => (
  <>
    <div className={`${P}-num`} aria-hidden>{String(n).padStart(2, '0')}</div>
    <h2 className={`${P}-title`}>{title}</h2>
  </>
)

type R = { rail?: ReactNode; node: ReactNode }

function entryRows(en: Entry, job: boolean): R[] {
  const dates = entryDates(en)
  const org = [en.organisation, en.location].filter(Boolean).join(', ')
  const head = (
    <>
      <h3 className={`${P}-etitle`}>
        {en.title}
        {org && <span className={`${P}-esub`}>{en.title ? (job && en.organisation ? ' at ' : ', ') : ''}{org}</span>}
      </h3>
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </>
  )
  const body = bodyPieces(en, P)
  const pieces = body.length ? [<>{head}{body[0]}</>, ...body.slice(1)] : [head]
  return pieces.map((node, i) => ({
    rail: i === 0 && dates ? <div className={`${P}-dates`}>{dates}</div> : null,
    node: <div className={i === pieces.length - 1 ? `${P}-entry-end` : undefined}>{node}</div>,
  }))
}

/** Every kind, in either column: a list of rows (rail content + body). */
function rows(sec: Section, r: Resume): R[] {
  switch (sec.kind) {
    case 'details':
      return detailRows(r.basics).map((d) => ({
        node: (
          <div className={`${P}-fact`}>
            <div className={`${P}-label`}>{d.label}</div>
            <div>{d.lines.map((l, i) => <div key={i}>{l}</div>)}</div>
          </div>
        ),
      }))
    case 'text':
      return paragraphs(sec.text, `${P}-text`).map((node) => ({ node }))
    case 'entries':
      return sec.items.flatMap((en) => entryRows(en, !!sec.job))
    case 'levels':
      return sec.items.map((s) => ({
        node: (
          <div className={`${P}-level`}>
            <span className={`${P}-lname`}>{s.name}</span>
            <span className={`${P}-track`} aria-hidden><span style={{ width: `${levelPct(s.level)}%` }} /></span>
            <span className={`${P}-score`}>{Math.min(5, Math.max(0, s.level))}/5</span>
          </div>
        ),
      }))
    case 'links':
      return sec.items.map((l) => ({
        node: <a className={`${P}-link`} href={l.url}>{l.label}<span aria-hidden> ↗</span></a>,
      }))
  }
}

export function SwissLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const secs = [...zoneSections(r, 'side'), ...zoneSections(r, 'main')]
  let n = 0
  const main: Unit[] = secs.flatMap((sec) => {
    const rs = rows(sec, r)
    if (!rs.length) return []
    n += 1
    const num = n
    return rs.map((row, i): Unit => ({
      key: `${sec.id}-${i}`,
      section: sec.id,
      end: i === rs.length - 1 ? 'section' : undefined,
      node: i === 0 && sec.kind === 'entries' ? (
        <>
          <div className={`${P}-head`}>
            <Row opener={<div className={`${P}-rule`} aria-hidden />} rail={<Label n={num} title={sec.title} />} />
          </div>
          <Row rail={row.rail}>{row.node}</Row>
        </>
      ) : i === 0 ? (
        <Row free={rs.length >= 2} opener={<div className={`${P}-rule`} aria-hidden />} rail={<><Label n={num} title={sec.title} />{row.rail}</>}>{row.node}</Row>
      ) : (
        <Row rail={row.rail}>{row.node}</Row>
      ),
    }))
  })

  const contact = [['Email', b.email], ['Phone', b.phone], ['Location', locationLine(b)]].filter(([, v]) => v)
  const header = (
    <header className={`${P}-header`}>
      {(b.firstName || b.lastName) && (
        <h1 className={`${P}-name`}>
          {b.firstName}{b.firstName && b.lastName && <br />}{b.lastName}
        </h1>
      )}
      {(contact.length > 0 || b.headline) && (
        <div className={`${P}-hrow`}>
          <div className={`${P}-contact`}>
            {contact.map(([k, v]) => (
              <div key={k}><div className={`${P}-label`}>{k}</div><div className={`${P}-cval`}>{v}</div></div>
            ))}
          </div>
          <div>
            {b.headline && <><div className={`${P}-bar`} aria-hidden /><div className={`${P}-headline`}>{b.headline}</div></>}
          </div>
        </div>
      )}
      <div className={`${P}-hrule`} aria-hidden />
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className={P} header={header} side={[]} main={main} />
}
