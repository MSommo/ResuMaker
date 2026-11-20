const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago": how long ago `iso` was, relative to `now`. */
export function timeAgo(iso: string, now: Date = new Date(), locale?: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000)
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return fmt.format(Math.trunc(seconds / size), unit)
  }
  return 'just now'
}
