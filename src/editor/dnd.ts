import type { SectionKind } from '../model/types'

/** What is being dragged. Draggable ids: section id · `tpl:<id>` (new component) · `stash:<id>` (removed section). */
export type DragData = { type: 'section'; id: string } | { type: 'template'; tid: string } | { type: 'stash'; id: string }

/** A landing spot: a column, and the position among its cards (the dragged card itself not counted). */
export type Slot = { zone: string; index: number }

/** What is being dragged, as far as a column can tell. `id`: the section (null for a new one); `from`: its column. */
export type Active = { id: string | null; kind: SectionKind; icon: string; from: string | null }

/**
 * The drag in progress. Exactly one gap is open at a time: at `at`, which the other cards make room for.
 * A placed section that is not over a column that takes it shows its gap back where it came from (letting go there
 * changes nothing). Over the drawer there is no gap at all: letting go removes it from the CV.
 */
export interface DragState {
  data: DragData
  info: Active
  origin: Slot | null
  at: Slot | null
  overDrawer: boolean
  /** Height of the gap: the card being dragged. */
  height: number
}

export const sameSlot = (a: Slot | null, b: Slot | null) => a === b || (!!a && !!b && a.zone === b.zone && a.index === b.index)

/** The card list of a column (see Structure.tsx). */
export const listEl = (zone: string) => document.querySelector<HTMLElement>(`[data-zone-list="${zone}"]`)

/**
 * Where in `list` a card centred at viewport height `y` lands: the number of cards whose middle is above it.
 * Layout positions (offsetTop) are used, not the animated ones, so the answer doesn't flicker while cards slide.
 * Cards below the open gap sit lower by its height, which gives a natural dead band: no back and forth on a boundary.
 */
export function slotIndex(list: HTMLElement, y: number): number {
  const rel = y - list.getBoundingClientRect().top
  let n = 0
  for (const el of list.querySelectorAll<HTMLElement>(':scope > [data-slot]')) if (el.offsetTop + el.offsetHeight / 2 < rel) n++
  return n
}
