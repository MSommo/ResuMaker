import type { ReactNode } from 'react'
import { fullName } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Resume, Section } from '../../model/types'
import { Paginated, type Unit } from '../Paginated'
import { detailRows, entryPieces, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs } from '../shared'
import './terminal.css'

const P = 'lx-terminal'

const kebab = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section'

const Prompt = ({ cmd, arg }: { cmd: string; arg?: string }) => (
  <div className={`${P}-prompt`}>
    <span className={`${P}-ps`} aria-hidden>$</span> <span className={`${P}-cmd`}>{cmd}</span>
    {arg && <> <span className={`${P}-arg`}>{arg}</span></>}
  </div>
)

const Heading = ({ cmd, slug }: { cmd: string; slug: string }) => (
  <h2 className={`${P}-heading`}>
    <span className={`${P}-ps`} aria-hidden>$</span> <span className={`${P}-cmd`}>{cmd}</span> <span className={`${P}-arg`}>~/{slug}</span>
  </h2>
)

const dateRange = (en: Entry) => [en.start, en.current ? 'present' : en.end].filter(Boolean).join(' → ')

function entryHead(en: Entry): ReactNode {
  const dates = dateRange(en)
  return (
    <div className={`${P}-entry`}>
      <div className={`${P}-entry-line`}>
        {en.title && <h3 className={`${P}-title`}>{en.title}</h3>}
        {en.organisation && <span className={`${P}-org`}>{en.title ? '@ ' : ''}{en.organisation}</span>}
        {dates && <span className={`${P}-dates`}>[{dates}]</span>}
        {en.location && <span className={`${P}-loc`}># {en.location}</span>}
      </div>
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </div>
  )
}

function sectionUnits(sec: Section, b: Basics): Unit[] {
  const slug = kebab(sec.title)
  const make = (cmd: string, nodes: ReactNode[]) =>
    nodes.length ? withHeading(sec.id, <Heading cmd={cmd} slug={slug} />, nodes, 'rule') : []
  switch (sec.kind) {
    case 'details': {
      const rows = detailRows(b)
      if (!rows.length) return []
      const node = (
        <div className={`${P}-env`}>
          {rows.map((r) => (
            <div key={r.label}>
              <span className={`${P}-key`}>{r.label.startsWith('Date') ? 'born' : r.label.toLowerCase()}</span>
              <span className={`${P}-eq`}>=</span>
              <span className={`${P}-val`}>{r.lines.join(', ')}</span>
            </div>
          ))}
        </div>
      )
      return make('cat', [node])
    }
    case 'text':
      return make('cat', paragraphs(sec.text, `${P}-text`))
    case 'entries':
      return make('ls', sec.items.flatMap((en) => entryPieces(en, P, entryHead(en))))
    case 'levels':
      return make(
        'ls',
        sec.items.map((s) => (
          <div key={s.id} className={`${P}-level`}>
            <span className={`${P}-level-name`}>{s.name}</span>
            <span className={`${P}-cells`} role="img" aria-label={`${s.level} of 5`}>
              {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= s.level ? 'on' : ''} />)}
            </span>
            <span className={`${P}-count`}>{s.level}/5</span>
          </div>
        )),
      )
    case 'links':
      return make(
        'ls',
        sec.items.map((l) => (
          <div key={l.id} className={`${P}-linkrow`}>
            <span aria-hidden className={`${P}-arrow`}>→ </span>
            <a className={`${P}-link`} href={l.url}>{l.label || l.url}</a>
          </div>
        )),
      )
  }
}

export function TerminalLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const name = fullName(b)
  const handle = name.toLowerCase().replace(/\s+/g, '') || 'user'

  const units = [...zoneSections(r, 'side'), ...zoneSections(r, 'main')].flatMap((s) => sectionUnits(s, b))
  if (units.length) {
    units[units.length - 1] = { ...units[units.length - 1], end: 'section' }
    units.push({
      key: 'closing',
      node: (
        <div className={`${P}-prompt ${P}-closing`}>
          <span className={`${P}-ps`} aria-hidden>$</span> <span className={`${P}-block`} aria-hidden />
        </div>
      ),
    })
  }

  const header = (
    <header className={`${P}-header`}>
      <div className={`${P}-bar`} aria-hidden>
        <span className={`${P}-dots`}><i /><i /><i /></span>
        <span className={`${P}-bar-title`}>{handle}@cv: ~</span>
      </div>
      <Prompt cmd="whoami" />
      {name ? (
        <h1 className={`${P}-name`}>{name}<span className={`${P}-block`} aria-hidden /></h1>
      ) : (
        <div className={`${P}-none`}>(no output)</div>
      )}
      {b.headline && (
        <>
          <Prompt cmd="cat" arg="headline" />
          <div className={`${P}-headline`}>{b.headline}</div>
        </>
      )}
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className={P} header={header} side={[]} main={units} />
}
