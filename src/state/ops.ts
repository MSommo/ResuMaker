import { getLayout, type LayoutDef } from '../layouts/registry'
import type { Resume, Section, SectionKind } from '../model/types'

export const zoneAccepts = (layout: LayoutDef, zone: string, kind: SectionKind) =>
  !!layout.zones.find((z) => z.id === zone)?.accepts.includes(kind)

/** First zone that can hold `kind`, preferring `prefer`. */
export function pickZone(layout: LayoutDef, kind: SectionKind, prefer?: string): string | null {
  if (prefer && zoneAccepts(layout, prefer, kind)) return prefer
  return layout.zones.find((z) => z.accepts.includes(kind))?.id ?? null
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
    const oi = without.findIndex((s) => s.id === overId)
    let after = false
    // Dragging downwards inside the same zone lands after the target, like a normal sortable list.
    const zoneIds = list.filter((s) => s.zone === zone).map((s) => s.id)
    if (list.find((s) => s.id === sec.id)?.zone === zone) after = zoneIds.indexOf(sec.id) < zoneIds.indexOf(overId)
    idx = oi < 0 ? without.length : oi + (after ? 1 : 0)
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
    if (s.zone === null || zoneAccepts(layout, s.zone, s.kind)) return s
    return { ...s, zone: pickZone(layout, s.kind) } as Section
  })
  return { ...r, layoutId: layout.id, sections }
}
