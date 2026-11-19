import type { Entry } from './types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2025-10` → "Oct 2025"; `2025` → "2025"; anything else is shown as typed. */
export function formatMonth(v: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(v)
  return m ? `${MONTHS[+m[2] - 1] ?? ''} ${m[1]}`.trim() : v
}

export const entryDates = (e: Pick<Entry, 'start' | 'end' | 'current'>) =>
  [formatMonth(e.start), e.current ? 'Present' : formatMonth(e.end)].filter(Boolean).join(' — ')

/** `1993-03-19` → "19/03/1993". */
export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** Best-effort parse of free text such as "Sept 2009" into `YYYY-MM` (used when migrating old data). */
export function parseLooseMonth(s: string): string {
  const t = s.trim()
  const m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/.exec(t)
  if (m) {
    const i = MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase())
    if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, '0')}`
  }
  return t
}

/** `19/03/1993` → `1993-03-19`. */
export function parseLooseDay(s: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim())
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''
}
