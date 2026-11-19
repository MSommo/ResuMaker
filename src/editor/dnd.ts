import type { Section } from '../model/types'

/** What is being dragged. Draggable ids: section id · `tpl:<id>` (new component) · `stash:<id>` (removed section). */
export type DragData = { type: 'section'; id: string } | { type: 'template'; tid: string } | { type: 'stash'; id: string }

export type DropTarget = { drawer: true } | { drawer?: false; zone: string; overId: string | null }

/** Droppable ids: `drawer` · `zone:<id>` · a section id (drop before it). */
export function resolveOver(id: string, sections: Section[]): DropTarget | null {
  if (id === 'drawer') return { drawer: true }
  if (id.startsWith('zone:')) return { zone: id.slice(5), overId: null }
  const s = sections.find((x) => x.id === id)
  return s?.zone ? { zone: s.zone, overId: s.id } : null
}
