import type { ReactNode } from 'react'
import { splitBlocks } from '../components/markdown/blocks'
import { Md } from '../components/markdown/Markdown'
import { addressLines, birthLines } from '../model/format'
import { zoneSections } from '../model/sections'
import type { Resume } from '../model/types'

/** Inline Markdown (bold, italic, strike, links, code): for single-line fields such as bullets and highlight lines. */
export function Rich({ text }: { text: string }) {
  return <Md source={text} inline />
}

/**
 * Full Markdown, one node per top-level block (a paragraph, a heading, a table, one list item…), so the paginator
 * can place each on a page separately. `className` gives the layout's text style and spacing.
 */
export const paragraphs = (text: string, className: string): ReactNode[] =>
  splitBlocks(text).map(({ src, tight }, i) => (
    <div key={`p${i}`} className={`${className} md${tight ? ' md-item' : ''}`}>
      <Md source={src} />
    </div>
  ))

export type BulletItem = { type: 'heading' | 'bullet'; text: string }

/** Lines starting with `#` are subheadings that group the bullets after them. */
export const parseBullets = (lines: string[]): BulletItem[] =>
  lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l): BulletItem => (l.startsWith('#') ? { type: 'heading', text: l.replace(/^#+\s*/, '') } : { type: 'bullet', text: l }))
    .filter((b) => b.text.trim())

/** "Title, Org, Location" — or "Title at Org, Location" for jobs. */
export const entryLine = (e: { title: string; organisation: string; location: string }, at = false) => {
  const head = at && e.organisation ? `${e.title} at ${e.organisation}` : [e.title, e.organisation].filter(Boolean).join(', ')
  return [head, e.location].filter(Boolean).join(', ')
}

/**
 * What a layout draws under the name: the sections placed in the header zone. Profile is a block of text; Personal details is a
 * compact line of facts. `data-sec` lets a click on them open their editor.
 */
export function HeaderExtras({ resume: r }: { resume: Resume }) {
  const b = r.basics
  const blocks = zoneSections(r, 'header').flatMap((s) => {
    if (s.kind === 'text') return s.text.trim() ? [<div key={s.id} className="hx-text" data-sec={s.id}>{paragraphs(s.text, 'hx-p')}</div>] : []
    if (s.kind !== 'details') return []
    const born = birthLines(b).join(', ')
    const facts: [string, string][] = ([
      ['Address', addressLines(b).join(', ')], ['Phone', b.phone], ['Email', b.email], ['Born', born], ['Nationality', b.nationality],
    ] as [string, string][]).filter(([, v]) => v)
    return facts.length ? [<div key={s.id} className="hx-facts" data-sec={s.id}>{facts.map(([k, v]) => <span key={k}><b>{k}</b> {v}</span>)}</div>] : []
  })
  return blocks.length ? <div className="hx">{blocks}</div> : null
}
