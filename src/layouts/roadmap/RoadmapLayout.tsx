import type { ReactNode } from 'react'
import { entryDates } from '../../model/dates'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import { LEVEL_LABEL, type Basics, type Entry, type Resume, type Section } from '../../model/types'
import { SECTION_ICONS } from '../icons'
import { Paginated, type Unit } from '../Paginated'
import { detailRows, entryPieces } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './roadmap.css'

const P = 'lx-roadmap'
const pad2 = (n: number) => String(n).padStart(2, '0')
const hasIcon = (s: Section) => !!s.icon && s.icon !== 'none'

/** A numbered milestone node on the track. */
const Node = ({ n, now }: { n: number; now?: boolean }) => (
  <span className={`${P}-node${now ? ` ${P}-node-now` : ''}`} aria-hidden>{pad2(n)}</span>
)

const titleLine = (en: Entry, job: boolean) => (
  <>
    <h3 className={`${P}-title`}>
      {en.title}
      {job && en.organisation && <span className={`${P}-org`}> at {en.organisation}</span>}
    </h3>
    {!job && en.organisation && <div className={`${P}-org ${P}-org-line`}>{en.organisation}</div>}
  </>
)

function entryHead(en: Entry, job: boolean, n: number): ReactNode {
  const dates = entryDates(en)
  return (
    <>
      <Node n={n} now={en.current} />
      {titleLine(en, job)}
      {(en.location || dates || en.current) && (
        <div className={`${P}-meta${en.current ? ` ${P}-meta-now` : ''}`}>
          {en.current && <span className={`${P}-now`}>NOW</span>}
          {en.location && <span>{en.location}</span>}
          {en.location && dates && <span aria-hidden>&nbsp;·&nbsp;</span>}
          {dates && <span className={`${P}-dates`}>{dates}</span>}
        </div>
      )}
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </>
  )
}

/** Compact entry for a side card (no track). */
function sideEntry(en: Entry, job: boolean): ReactNode[] {
  const dates = entryDates(en)
  const head = (
    <>
      {titleLine(en, job)}
      {(en.location || dates) && <div className={`${P}-meta`}>{[en.location, dates].filter(Boolean).join(' · ')}</div>}
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </>
  )
  return entryPieces(en, P, head)
}

const levelRow = (id: string, name: string, level: number) => (
  <div key={id} className={`${P}-level`}>
    <div className={`${P}-level-top`}>
      <span className={`${P}-level-name`}>{name}</span>
      <span className={`${P}-level-n`}>{level}/5<span className="sr"> {LEVEL_LABEL[level]}</span></span>
    </div>
    <div className={`${P}-pills`} aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= level ? 'on' : undefined} />)}
    </div>
  </div>
)

const linkItem = (id: string, label: string, url: string) => (
  <a key={id} className={`${P}-link`} href={url}>{label || url}<span aria-hidden> ↗</span></a>
)

const detailsNode = (b: Basics): ReactNode => (
  <dl className={`${P}-details`}>
    {detailRows(b).map((r) => (
      <div key={r.label}>
        <dt>{r.label}</dt>
        {r.lines.map((l, i) => <dd key={i}>{l}</dd>)}
      </div>
    ))}
  </dl>
)

/** Content of a section other than entries, as breakable nodes (used by both zones). */
function plainNodes(sec: Section, b: Basics): ReactNode[] {
  switch (sec.kind) {
    case 'details': return detailRows(b).length ? [detailsNode(b)] : []
    case 'text': return paragraphs(sec.text, `${P}-text`)
    case 'levels': return sec.items.filter((i) => i.name).map((i) => levelRow(i.id, i.name, i.level))
    case 'links': return sec.items.filter((i) => i.url || i.label).map((i) => linkItem(i.id, i.label, i.url))
    case 'entries': return []
  }
}

function sideUnits(sec: Section, b: Basics): Unit[] {
  const nodes = sec.kind === 'entries' ? sec.items.flatMap((e) => sideEntry(e, sec.job)) : plainNodes(sec, b)
  return nodes.map((node, i) => {
    const first = i === 0
    const last = i === nodes.length - 1
    return {
      key: `${sec.id}-${i}`,
      section: sec.id,
      end: last ? ('section' as const) : undefined,
      node: (
        <div className={`${P}-card${first ? ' first' : ''}${last ? ' last' : ''}`}>
          {first && (
            <h2 className={`${P}-side-h`}>
              {hasIcon(sec) && <span className={`${P}-ico`}>{SECTION_ICONS[sec.icon]}</span>}
              <span>{sec.title}</span>
            </h2>
          )}
          {node}
        </div>
      ),
    }
  })
}

function mainUnits(sec: Section, b: Basics): Unit[] {
  let flat: ReactNode[]
  if (sec.kind === 'entries') {
    flat = sec.items.flatMap((e, i) => entryPieces(e, P, entryHead(e, sec.job, i + 1)))
  } else {
    // everything else is a single milestone: the node sits on the first node, the rest follows
    const nodes = plainNodes(sec, b)
    flat = nodes.map((n, i) => (
      <div key={i} className={i === nodes.length - 1 ? `${P}-entry-end` : undefined}>{i === 0 && <Node n={1} />}{n}</div>
    ))
  }
  return flat.map((node, i) => ({
    key: `${sec.id}-${i}`,
    section: sec.id,
    end: i === flat.length - 1 ? ('section' as const) : undefined,
    node: (
      <div className={`${P}-seg${i === 0 ? ' first' : ''}${i === flat.length - 1 ? ' last' : ''}`}>
        {i === 0 && (
          <h2 className={`${P}-h`}>
            <span className={`${P}-h-ico${hasIcon(sec) ? '' : ' bare'}`} aria-hidden>{hasIcon(sec) ? SECTION_ICONS[sec.icon] : null}</span>
            <span className={`${P}-h-t`}>{sec.title}</span>
            <span className={`${P}-h-rule`} aria-hidden />
          </h2>
        )}
        <div className={`${P}-seg-body`}>{node}</div>
      </div>
    ),
  }))
}

export function RoadmapLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const name = fullName(b)
  const chips = [b.email, b.phone, locationLine(b)].filter(Boolean)
  const side = zoneSections(r, 'side').flatMap((s) => sideUnits(s, b))
  const main = zoneSections(r, 'main').flatMap((s) => mainUnits(s, b))

  const header = (
    <header className={`${P}-header`}>
      {name && <h1 className={`${P}-name`}>{name}</h1>}
      {b.headline && <div className={`${P}-headline`}>{b.headline}</div>}
      {chips.length > 0 && (
        <ul className={`${P}-chips`}>
          {chips.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
      <HeaderExtras resume={r} />
    </header>
  )
  return <Paginated className={P} header={header} side={side} main={main} />
}
