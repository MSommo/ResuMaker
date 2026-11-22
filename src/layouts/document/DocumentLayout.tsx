import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { fullName, locationLine } from '../../model/format'
import { zoneSections } from '../../model/sections'
import type { Basics, Entry, Resume, Section } from '../../model/types'
import { detailRows } from '../kit'
import { Paginated, type Unit } from '../Paginated'
import { HeaderExtras, Rich, paragraphs, parseBullets } from '../shared'
import './document.css'

/* The CV drawn as a JSON file: one column of "rows" (a gutter + an indented line), syntax-coloured. */

const P = 'lx-document'

/** One line of the file: `d` = nesting depth (2 characters per level), `open` draws the fold chevron in the gutter. */
function Row({ d, open, cont, children }: { d: number; open?: boolean; cont?: boolean; children: ReactNode }) {
  return (
    <div className={`${P}-row`} style={{ '--d': d } as CSSProperties}>
      <span className={`${P}-gut`} aria-hidden>{open ? '▾' : ''}</span>
      <div className={`${P}-ln`}>
        <div className={`${P}-v${cont ? ` ${P}-cont` : ''}`}>{children}</div>
      </div>
    </div>
  )
}

const K = ({ k }: { k: string }) => (
  <>
    <span className={`${P}-k`}>&quot;{k}&quot;</span>
    <span className={`${P}-p`}>: </span>
  </>
)
const S = ({ children }: { children: ReactNode }) => <span className={`${P}-s`}>&quot;{children}&quot;</span>
const Cm = ({ last }: { last?: boolean }) => (last ? null : <span className={`${P}-p`}>,</span>)
const Pn = ({ children }: { children: ReactNode }) => <span className={`${P}-p`}>{children}</span>
const Null = () => <span className={`${P}-b`}>null</span>
const Comment = ({ d, children, h2 }: { d: number; children: ReactNode; h2?: boolean }) => (
  <Row d={d}>
    {h2 ? <h2 className={`${P}-c ${P}-h`}>// {children}</h2> : <span className={`${P}-c`}>// {children}</span>}
  </Row>
)

const frag = (rows: ReactNode[]) => rows.map((r, i) => <Fragment key={i}>{r}</Fragment>)
const safeHref = (u: string) => (/^(https?:|mailto:|tel:)/i.test(u.trim()) ? u.trim() : undefined)

/** "Employment History" -> employmentHistory */
function camel(title: string, fallback: string): string {
  const words = title.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean)
  if (!words.length) return fallback
  return words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('')
}

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

interface Parts {
  head: ReactNode[]
  pieces: ReactNode[][]
  tail: (last: boolean) => ReactNode[]
}

const hasEntry = (en: Entry) =>
  !!(en.title || en.organisation || en.location || en.start || en.end || en.current || en.note || en.description.trim() || parseBullets(en.bullets).some((b) => b.type === 'bullet'))

/** The rows of one entry object, as breakable pieces. `d` = depth of the object's braces. */
function entryPieces(en: Entry, d: number, last: boolean): ReactNode[][] {
  const bullets = parseBullets(en.bullets)
  const hasBullets = bullets.some((b) => b.type === 'bullet')
  const paras = en.description.trim() ? paragraphs(en.description, `${P}-text`) : []
  const inline: { k: string; v: ReactNode }[] = []
  if (en.title) inline.push({ k: 'title', v: <S><h3 className={`${P}-title`}>{en.title}</h3></S> })
  if (en.organisation) inline.push({ k: 'organisation', v: <S>{en.organisation}</S> })
  if (en.location) inline.push({ k: 'location', v: <S>{en.location}</S> })
  if (en.start) inline.push({ k: 'start', v: <S>{en.start}</S> })
  if (en.start || en.end || en.current) inline.push({ k: 'end', v: en.current || !en.end ? <Null /> : <S>{en.end}</S> })
  if (en.current) inline.push({ k: 'current', v: <span className={`${P}-b`}>true</span> })
  if (en.note) inline.push({ k: 'note', v: <S><span className={`${P}-note`}><Rich text={en.note} /></span></S> })
  const total = inline.length + (paras.length ? 1 : 0) + (hasBullets ? 1 : 0)
  const f = d + 1
  const pieces: ReactNode[][] = [
    [
      <Row key="o" d={d} open><Pn>{'{'}</Pn></Row>,
      ...inline.map(({ k, v }, i) => (
        <Row key={k} d={f}><K k={k} />{v}<Cm last={i === total - 1} /></Row>
      )),
    ],
  ]
  paras.forEach((p, i) =>
    pieces.push([
      <Row key={`d${i}`} d={f} cont={i > 0}>
        {i === 0 && <K k="description" />}
        <span className={`${P}-s`}>{i === 0 ? '"' : ''}{p}{i === paras.length - 1 ? '"' : ''}</span>
        {i === paras.length - 1 && <Cm last={!hasBullets} />}
      </Row>,
    ]),
  )
  if (hasBullets) {
    const nb = bullets.filter((b) => b.type === 'bullet').length
    let seen = 0
    let pending: ReactNode[] = []
    bullets.forEach((b, i) => {
      if (b.type === 'heading') {
        pending.push(<Comment key={`c${i}`} d={f + 1}><Rich text={b.text} /></Comment>)
        return
      }
      const rows: ReactNode[] = []
      if (seen === 0) rows.push(<Row key="bo" d={f} open><K k="bullets" /><Pn>[</Pn></Row>)
      rows.push(...pending)
      pending = []
      seen++
      rows.push(<Row key={`b${i}`} d={f + 1}><S><Rich text={b.text} /></S><Cm last={seen === nb} /></Row>)
      pieces.push(rows)
    })
    pieces[pieces.length - 1].push(<Row key="bc" d={f}><Pn>]</Pn></Row>)
  }
  pieces[pieces.length - 1].push(<Row key="c" d={d}><Pn>{'}'}</Pn><Cm last={last} /></Row>)
  if (pieces.length > 1) {
    pieces[1] = [...pieces[0], ...pieces[1]]
    pieces.shift()
  }
  return pieces
}

const DETAIL_LABELS = ['Address', 'Phone', 'Email', 'Date / place of birth', 'Nationality']
const DETAIL_KEYS = ['address', 'phone', 'email', 'birth', 'nationality']

function hasContent(sec: Section, b: Basics): boolean {
  switch (sec.kind) {
    case 'details': return detailRows(b).length > 0
    case 'text': return !!sec.text.trim()
    case 'entries': return sec.items.some(hasEntry)
    case 'levels': return sec.items.some((i) => i.name.trim())
    case 'links': return sec.items.some((l) => l.label.trim() || l.url.trim())
  }
}

/** Rows for one section (exhaustive over the five kinds, used for both zones). */
function sectionParts(sec: Section, b: Basics, key: string, last: boolean): Parts {
  const cm = <Comment key="cm" d={1} h2>{sec.title || key}</Comment>
  const close = (ch: string) => (l: boolean) => [<Row key="x" d={1}><Pn>{ch}</Pn><Cm last={l} /></Row>]
  const opener = (ch: string) => <Row key="op" d={1} open><K k={key} /><Pn>{ch}</Pn></Row>
  switch (sec.kind) {
    case 'details': {
      const rows = detailRows(b)
      return {
        head: [cm, opener('{')],
        pieces: rows.map((r, i) => [
          <Row key={r.label} d={2}>
            <K k={DETAIL_KEYS[DETAIL_LABELS.indexOf(r.label)] ?? r.label} />
            <S>{r.lines.join(', ')}</S>
            <Cm last={i === rows.length - 1} />
          </Row>,
        ]),
        tail: close('}'),
      }
    }
    case 'text': {
      const ps = paragraphs(sec.text, `${P}-text`)
      return {
        head: [cm],
        pieces: ps.map((p, i) => [
          <Row key={i} d={1} cont={i > 0}>
            {i === 0 && <K k={key} />}
            <span className={`${P}-s`}>{i === 0 ? '"' : ''}{p}{i === ps.length - 1 ? '"' : ''}</span>
            {i === ps.length - 1 && <Cm last={last} />}
          </Row>,
        ]),
        tail: () => [],
      }
    }
    case 'entries': {
      const items = sec.items.filter(hasEntry)
      return {
        head: [cm, opener('[')],
        pieces: items.flatMap((en, i) => entryPieces(en, 2, i === items.length - 1)),
        tail: close(']'),
      }
    }
    case 'levels': {
      const items = sec.items.filter((i) => i.name.trim())
      return {
        head: [cm, opener('{')],
        pieces: items.map((it, i) => [
          <Row key={it.id} d={2}>
            <K k={it.name} />
            <span className={`${P}-n`}>{Math.min(5, Math.max(0, it.level))}</span>
            <Cm last={i === items.length - 1} />
          </Row>,
        ]),
        tail: close('}'),
      }
    }
    case 'links': {
      const items = sec.items.filter((l) => l.label.trim() || l.url.trim())
      return {
        head: [cm, opener('{')],
        pieces: items.map((l, i) => {
          const href = safeHref(l.url)
          return [
            <Row key={l.id} d={2}>
              <K k={l.label || 'link'} />
              <S>{href ? <a href={href}>{l.url}</a> : l.url}</S>
              <Cm last={i === items.length - 1} />
            </Row>,
          ]
        }),
        tail: close('}'),
      }
    }
  }
}

function toUnits(secId: string, p: Parts, last: boolean): Unit[] {
  const pieces = p.pieces.length ? p.pieces.map((r) => [...r]) : [[]]
  pieces[0] = [...p.head, ...pieces[0]]
  const end = pieces.length - 1
  pieces[end] = [...pieces[end], ...p.tail(last)]
  if (last) pieces[end].push(<Row key="root" d={0}><Pn>{'}'}</Pn></Row>)
  return pieces.map((rows, i) => ({
    key: `${secId}-${i}`,
    section: secId,
    node: <>{frag(rows)}</>,
    end: i === end ? 'section' : undefined,
  }))
}

const headerHasExtras = (r: Resume) =>
  zoneSections(r, 'header').some((s) => (s.kind === 'text' && s.text.trim() !== '') || (s.kind === 'details' && detailRows(r.basics).length > 0))

export function DocumentLayout({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const name = fullName(b)
  const location = locationLine(b)
  const extras = headerHasExtras(r)

  // One column: side sections first, then main sections.
  const secs = [...zoneSections(r, 'side'), ...zoneSections(r, 'main')].filter((s) => hasContent(s, b))
  const used = new Set(['name', 'headline', 'email', 'phone', 'location', 'summary'])
  const keys = secs.map((s) => {
    const base = camel(s.title, s.kind)
    let k = base
    for (let n = 2; used.has(k); n++) k = `${base}${n}`
    used.add(k)
    return k
  })
  const units = secs.flatMap((s, i) => toUnits(s.id, sectionParts(s, b, keys[i], i === secs.length - 1), i === secs.length - 1))

  const hk: { k: string; v: ReactNode }[] = []
  if (name) hk.push({ k: 'name', v: <h1 className={`${P}-name`}>&quot;{name}&quot;</h1> })
  if (b.headline) hk.push({ k: 'headline', v: <S>{b.headline}</S> })
  if (b.email) hk.push({ k: 'email', v: <S>{b.email}</S> })
  if (b.phone) hk.push({ k: 'phone', v: <S>{b.phone}</S> })
  if (location) hk.push({ k: 'location', v: <S>{location}</S> })
  const more = units.length > 0
  const total = hk.length + (extras ? 1 : 0)

  if (!more) {
    units.push({
      key: 'close',
      node: (
        <>
          {total === 0 && <Comment d={1}>empty</Comment>}
          <Row d={0}><Pn>{'}'}</Pn></Row>
        </>
      ),
    })
  }

  const header = (
    <header className={`${P}-header`}>
      <div className={`${P}-tabs`} aria-hidden>
        <span className={`${P}-tab`}>
          <span className={`${P}-dot`} />
          {`${slug(name) || 'untitled'}.cv.json`}
        </span>
      </div>
      <div className={`${P}-top`}>
        <Row d={0} open><Pn>{'{'}</Pn></Row>
        {hk.map(({ k, v }, i) => (
          <Row key={k} d={1}><K k={k} />{v}<Cm last={!more && !extras && i === hk.length - 1} /></Row>
        ))}
        {extras && (
          <Row d={1}>
            <K k="summary" />
            <span className={`${P}-s ${P}-sum`}>&quot;<HeaderExtras resume={r} />&quot;</span>
            <Cm last={!more} />
          </Row>
        )}
      </div>
    </header>
  )

  return <Paginated className={P} header={header} side={[]} main={units} />
}
