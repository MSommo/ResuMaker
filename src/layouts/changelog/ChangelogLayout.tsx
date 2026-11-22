import type { ReactNode } from 'react'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Resume, Section } from '../../model/types'
import { Paginated, type Unit } from '../Paginated'
import { detailRows, withHeading } from '../kit'
import { HeaderExtras, Rich, paragraphs, parseBullets } from '../shared'
import './changelog.css'

const P = 'lx-changelog'
const TAGS = ['green', 'blue', 'amber']

const host = (url: string) => {
  try { return new URL(url).host || url } catch { return url.replace(/^https?:\/\//, '') }
}

/** Body of an entry as separately breakable pieces; `# subheadings` become tag pills that cycle through three colours. */
function body(en: Entry): ReactNode[] {
  const out: ReactNode[] = en.description ? paragraphs(en.description, `${P}-text`) : []
  let pending: ReactNode = null
  let n = 0
  parseBullets(en.bullets).forEach((b, i) => {
    if (b.type === 'heading') {
      if (pending) out.push(pending)
      pending = <div key={`h${i}`} className={`${P}-tag ${P}-tag-${TAGS[n++ % TAGS.length]}`}><Rich text={b.text} /></div>
    } else {
      out.push(
        <div key={`b${i}`}>
          {pending}
          <ul className={`${P}-bullets`}><li><Rich text={b.text} /></li></ul>
        </div>,
      )
      pending = null
    }
  })
  if (pending) out.push(pending)
  return out
}

const titleLine = (en: Entry) => (
  <h3 className={`${P}-title`}>
    {en.title}
    {en.organisation && <span className={`${P}-org`}>{en.title ? ' @ ' : '@ '}{en.organisation}</span>}
  </h3>
)

/** A release: date gutter with commit node on the left, the entry on the right; the gutter line runs through every piece. */
function releasePieces(en: Entry, last: boolean): ReactNode[] {
  const gutter = (first: boolean) => (
    <div className={`${P}-gut${first ? ` ${P}-gut-first` : ''}`} aria-hidden={!first || undefined}>
      {first && (
        <>
          <span className={`${P}-node${en.current ? ` ${P}-node-head` : ''}`} aria-hidden />
          {en.start && <div className={`${P}-ver`}>{en.start}</div>}
          {en.current ? <div className={`${P}-headpill`}>HEAD</div> : en.end ? <div className={`${P}-prev`}>→ {en.end}</div> : null}
        </>
      )}
    </div>
  )
  const head = (
    <>
      {titleLine(en)}
      {en.location && <div className={`${P}-loc`}>{en.location}</div>}
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </>
  )
  const parts = body(en)
  const pieces = parts.length ? [<div key="h">{head}{parts[0]}</div>, ...parts.slice(1)] : [head]
  return pieces.map((node, i) => (
    <div key={i} className={`${P}-row${i === pieces.length - 1 && !last ? ` ${P}-row-end` : ''}`}>
      {gutter(i === 0)}
      <div className={`${P}-rel`}>{node}</div>
    </div>
  ))
}

/** Compact entry for the side panels (no gutter). */
function compactPieces(en: Entry): ReactNode[] {
  const when = [en.start, en.current ? 'HEAD' : en.end].filter(Boolean).join(' → ')
  const head = (
    <>
      {titleLine(en)}
      {(when || en.location) && <div className={`${P}-meta`}>{[when, en.location].filter(Boolean).join(' · ')}</div>}
      {en.note && <div className={`${P}-note`}><Rich text={en.note} /></div>}
    </>
  )
  const parts = body(en)
  const pieces = parts.length ? [<div key="h">{head}{parts[0]}</div>, ...parts.slice(1)] : [head]
  return pieces.map((node, i) => <div key={i} className={i === pieces.length - 1 ? `${P}-compact-end` : undefined}>{node}</div>)
}

function Squares({ level }: { level: number }) {
  return (
    <span className={`${P}-squares`} role="img" aria-label={`${level} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= level ? 'on' : undefined} />)}
    </span>
  )
}

function detailsNode(b: Basics): ReactNode {
  const key = (l: string) => l.toLowerCase().replace(/date \/ place of birth/, 'born').replace(/\s+/g, '_')
  return (
    <dl className={`${P}-kv`}>
      {detailRows(b).map((r) => (
        <div key={r.label}><dt>{key(r.label)}:</dt><dd>{r.lines.join(', ')}</dd></div>
      ))}
    </dl>
  )
}

function sectionUnits(sec: Section, b: Basics, side: boolean): Unit[] {
  const nodes: ReactNode[] = (() => {
    switch (sec.kind) {
      case 'details': return detailRows(b).length ? [detailsNode(b)] : []
      case 'text': return paragraphs(sec.text, `${P}-text`)
      case 'entries':
        return side
          ? sec.items.flatMap(compactPieces)
          : sec.items.flatMap((en, i) => releasePieces(en, i === sec.items.length - 1))
      case 'levels':
        return sec.items.map((l) => (
          <div key={l.id} className={`${P}-level`}><span>{l.name}</span><Squares level={l.level} /></div>
        ))
      case 'links':
        return sec.items.map((l) => (
          <div key={l.id} className={`${P}-link`}>
            <span className={`${P}-br`}>[</span><a href={l.url}>{l.label}</a><span className={`${P}-br`}>]({host(l.url)})</span>
          </div>
        ))
    }
  })()
  if (!nodes.length) return []
  if (side) {
    const n = nodes.length
    return nodes.map((node, i) => ({
      key: `${sec.id}-${i}`,
      section: sec.id,
      end: i === n - 1 ? ('section' as const) : undefined,
      node: (
        <div className={`${P}-panel${i === 0 ? ` ${P}-panel-first` : ''}${i === n - 1 ? ` ${P}-panel-last` : ''}`}>
          {i === 0 && (
            <>
              <div className={`${P}-fm`} aria-hidden>---</div>
              <h2 className={`${P}-ptitle`}>{sec.title}</h2>
            </>
          )}
          {node}
          {i === n - 1 && <div className={`${P}-fm`} aria-hidden>---</div>}
        </div>
      ),
    }))
  }
  const heading = <h2 className={`${P}-h2`}><span className={`${P}-hash`} aria-hidden>##</span> {sec.title}</h2>
  return withHeading(sec.id, heading, nodes, 'section')
}

export function ChangelogLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const name = fullName(b)
  const where = [b.email, b.phone, locationLine(b)].filter(Boolean)
  const side = zoneSections(r, 'side').flatMap((s) => sectionUnits(s, b, true))
  const main = zoneSections(r, 'main').flatMap((s) => sectionUnits(s, b, false))

  const header = (
    <header className={`${P}-header`}>
      {name && <h1><span className={`${P}-h1hash`} aria-hidden>#</span> {name}</h1>}
      {b.headline && <div className={`${P}-headline`}><span className={`${P}-h2hash`} aria-hidden>##</span> {b.headline}</div>}
      {where.length > 0 && <div className={`${P}-contact`}>{where.join(' · ')}</div>}
      {(name || b.headline || where.length > 0) && <div className={`${P}-hrule`} aria-hidden />}
      <HeaderExtras resume={r} />
    </header>
  )

  return <Paginated className={P} header={header} side={side} main={main} />
}
