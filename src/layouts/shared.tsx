import type { ReactNode } from 'react'

/** Renders `**bold**` and `*italic*` inline. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : p.startsWith('*') && p.endsWith('*') && p.length > 2 ? (
          <em key={i}>{p.slice(1, -1)}</em>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

/** One <p> per blank-line separated paragraph. */
export const paragraphs = (text: string, className: string): ReactNode[] =>
  text
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t, i) => (
      <p key={`p${i}`} className={className}>
        <Rich text={t} />
      </p>
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
