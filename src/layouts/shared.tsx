import type { ReactNode } from 'react'
import { splitBlocks } from '../components/markdown/blocks'
import { Md } from '../components/markdown/Markdown'

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
