/** Initials on a colour derived from the id, so each person keeps a recognisable avatar. */
export function Avatar({ id, first, last, size = 44 }: { id: string; first: string; last: string; size?: number }) {
  const hue = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  const initials = `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || '?'
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 38% 38%)` }} aria-hidden>
      {initials}
    </span>
  )
}
