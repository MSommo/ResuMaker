import type { ReactNode } from 'react'
import { addressLines, birthLines } from '../model/format'
import type { Basics, Entry } from '../model/types'
import type { Unit } from './Paginated'
import { Rich, paragraphs, parseBullets } from './shared'

/**
 * Building blocks shared by the layouts, so a layout is mostly its own CSS plus a small component. Everything here is
 * structure only (no styling): class names are `${p}-…`, where `p` is the layout's own prefix (e.g. 'dx').
 */

/** The body of an entry as separately breakable pieces: description paragraphs, then bullets (a `# subheading` line travels with the first bullet after it). */
export function bodyPieces(en: Entry, p: string): ReactNode[] {
  const body: ReactNode[] = en.description ? paragraphs(en.description, `${p}-text`) : []
  let pending: ReactNode = null
  parseBullets(en.bullets).forEach((b, i) => {
    if (b.type === 'heading') {
      if (pending) body.push(pending)
      pending = <div key={`h${i}`} className={`${p}-sub`}><Rich text={b.text} /></div>
    } else {
      body.push(
        <div key={`b${i}`}>
          {pending}
          <ul className={`${p}-bullets`}><li><Rich text={b.text} /></li></ul>
        </div>,
      )
      pending = null
    }
  })
  if (pending) body.push(pending)
  return body
}

/**
 * One entry as page-breakable pieces. `head` (title, dates, note...) always travels with the first body piece; the last piece
 * gets the class `${p}-entry-end` (put the space between entries there).
 */
export function entryPieces(en: Entry, p: string, head: ReactNode): ReactNode[] {
  const body = bodyPieces(en, p)
  const pieces = body.length ? [<div key="h">{head}{body[0]}</div>, ...body.slice(1)] : [head]
  return pieces.map((node, i) => <div key={i} className={i === pieces.length - 1 ? `${p}-entry-end` : undefined}>{node}</div>)
}

/** Turns a section's nodes into paginator units. The `heading` goes with the first node, so a title is never stranded at a page bottom. */
export function withHeading(key: string, heading: ReactNode, nodes: ReactNode[], end?: Unit['end']): Unit[] {
  return nodes.map((node, i) => ({
    key: `${key}-${i}`,
    section: key,
    node: i === 0 ? <>{heading}{node}</> : node,
    end: i === nodes.length - 1 ? end : undefined,
  }))
}

/** The personal-details facts that are filled in, in the order every layout shows them. */
export function detailRows(b: Basics): { label: string; lines: string[] }[] {
  return [
    { label: 'Address', lines: addressLines(b) },
    { label: 'Phone', lines: [b.phone].filter(Boolean) },
    { label: 'Email', lines: [b.email].filter(Boolean) },
    { label: 'Date / place of birth', lines: birthLines(b) },
    { label: 'Nationality', lines: [b.nationality].filter(Boolean) },
  ].filter((r) => r.lines.length > 0)
}

/** A skill level 1-5 as a 0-100 percentage (clamped). */
export const levelPct = (level: number) => (Math.min(5, Math.max(0, level)) / 5) * 100
