import { accepts, getLayout, type LayoutDef } from '../layouts/registry'
import type { Resume, Section, SectionKind } from '../model/types'

export const zoneAccepts = (layout: LayoutDef, zone: string, kind: SectionKind, icon = 'none') => {
  const z = layout.zones.find((x) => x.id === zone)
  return !!z && accepts(z, kind, icon)
}

/** First zone that can hold `kind`, preferring `prefer`. The header is never picked automatically. */
export function pickZone(layout: LayoutDef, kind: SectionKind, prefer?: string, icon = 'none'): string | null {
  if (prefer && zoneAccepts(layout, prefer, kind, icon)) return prefer
  return layout.zones.find((z) => z.id !== 'header' && accepts(z, kind, icon))?.id ?? null
}

/**
 * Put `sec` into `zone`, before `overId` (or at the end of the zone when null).
 * Works for new sections, stashed ones and ones already placed.
 */
export function place(list: Section[], sec: Section, zone: string, overId: string | null): Section[] {
  const moving = { ...sec, zone } as Section
  const without = list.filter((s) => s.id !== sec.id)
  let idx: number
  if (overId) {
    // Always lands before the card it was dropped on (the landing line is drawn there); the end of a column is overId = null.
    const oi = without.findIndex((s) => s.id === overId)
    idx = oi < 0 ? without.length : oi
  } else {
    let last = -1
    without.forEach((s, i) => {
      if (s.zone === zone) last = i
    })
    idx = last === -1 ? without.length : last + 1
  }
  return [...without.slice(0, idx), moving, ...without.slice(idx)]
}

export const stash = (list: Section[], id: string): Section[] => list.map((s) => (s.id === id ? ({ ...s, zone: null } as Section) : s))

/** Switch layout; sections that the new layout cannot host are moved to a zone that accepts them, or stashed. */
export function withLayout(r: Resume, layoutId: string): Resume {
  const layout = getLayout(layoutId)
  const sections = r.sections.map((s) => {
    if (s.zone === null || zoneAccepts(layout, s.zone, s.kind, s.icon)) return s
    return { ...s, zone: pickZone(layout, s.kind, undefined, s.icon) } as Section
  })
  return { ...r, layoutId: layout.id, sections }
}
