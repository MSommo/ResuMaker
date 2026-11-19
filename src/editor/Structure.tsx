import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Zone } from '../layouts/registry'
import { KIND_LABEL, type Section, type SectionKind } from '../model/types'
import { Chevron, Close, Grip, KindIcon } from '../components/icons'

export function CardFace({ sec }: { sec: Section }) {
  return (
    <>
      <KindIcon kind={sec.kind} className="card-kind" />
      <span className="card-text">
        <strong>{sec.title || 'Untitled'}</strong>
        <small>{KIND_LABEL[sec.kind]}</small>
      </span>
    </>
  )
}

function SortableCard({ sec, onSelect, onStash }: { sec: Section; onSelect: (id: string) => void; onStash: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sec.id, data: { type: 'section', id: sec.id } })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`card ${isDragging ? 'dragging' : ''}`}>
      <button type="button" className="grip" {...attributes} {...listeners} aria-label={`Reorder ${sec.title}. Press space, then use arrow keys.`}>
        <Grip />
      </button>
      <button type="button" className="card-main" onClick={() => onSelect(sec.id)} title="Edit content">
        <CardFace sec={sec} />
        <Chevron className="card-go" />
      </button>
      <button type="button" className="card-x" onClick={() => onStash(sec.id)} aria-label={`Remove ${sec.title} from the CV (content is kept)`} title="Remove from CV (content is kept)">
        <Close />
      </button>
    </li>
  )
}

export function ZoneBox({ zone, sections, activeKind, overZone, onSelect, onStash }: {
  zone: Zone
  sections: Section[]
  activeKind: SectionKind | null
  overZone: string | null
  onSelect: (id: string) => void
  onStash: (id: string) => void
}) {
  const { setNodeRef } = useDroppable({ id: `zone:${zone.id}` })
  const rejects = !!activeKind && !zone.accepts.includes(activeKind)
  return (
    <section className={`zone ${overZone === zone.id && !rejects ? 'over' : ''} ${rejects ? 'reject' : ''}`}>
      <header>
        <h3>{zone.label}</h3>
        <p>{rejects ? `This column can't hold ${KIND_LABEL[activeKind!].toLowerCase()} blocks` : zone.hint}</p>
      </header>
      <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="zone-list">
          {sections.map((s) => (
            <SortableCard key={s.id} sec={s} onSelect={onSelect} onStash={onStash} />
          ))}
          {sections.length === 0 && <li className="zone-empty">Drag components here</li>}
        </ul>
      </SortableContext>
    </section>
  )
}
