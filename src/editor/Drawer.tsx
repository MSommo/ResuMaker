import { useDraggable, useDroppable } from '@dnd-kit/core'
import { TEMPLATES, type Template } from '../model/templates'
import { KIND_LABEL, type Section } from '../model/types'
import { Close, Grip, KindIcon, Plus, Trash } from '../components/icons'

function Item({ id, data, kind, title, blurb, onAdd, onDelete }: {
  id: string
  data: object
  kind: Section['kind']
  title: string
  blurb: string
  onAdd: () => void
  onDelete?: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data })
  return (
    <li ref={setNodeRef} className={`dcard ${isDragging ? 'dragging' : ''}`} {...attributes} {...listeners}>
      <Grip className="dcard-grip" />
      <KindIcon kind={kind} className="card-kind" />
      <span className="card-text">
        <strong>{title}</strong>
        <small>{blurb}</small>
      </span>
      {onDelete && (
        <button type="button" className="card-x" onPointerDown={(e) => e.stopPropagation()} onClick={onDelete} aria-label={`Delete ${title} permanently`} title="Delete permanently">
          <Trash />
        </button>
      )}
      <button type="button" className="card-add" onPointerDown={(e) => e.stopPropagation()} onClick={onAdd} aria-label={`Add ${title}`} title="Add to CV">
        <Plus />
      </button>
    </li>
  )
}

export function Drawer({ open, onClose, removed, onAddTemplate, onAddRemoved, onDelete }: {
  open: boolean
  onClose: () => void
  removed: Section[]
  onAddTemplate: (t: Template) => void
  onAddRemoved: (id: string) => void
  onDelete: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'drawer', disabled: !open })
  return (
    <aside ref={setNodeRef} className={`drawer ${open ? 'open' : ''} ${isOver ? 'over' : ''}`} aria-label="Components" aria-hidden={!open} {...(open ? {} : ({ inert: '' } as object))}>
      <header>
        <h2>Components</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close components"><Close /></button>
      </header>
      <p className="drawer-hint">Drag a component into a column, or press <b>+</b>. Drop a section back here to remove it from the CV.</p>
      <div className="drawer-scroll">
        {removed.length > 0 && (
          <>
            <h3>Removed from CV <small>content kept</small></h3>
            <ul>
              {removed.map((s) => (
                <Item key={s.id} id={`stash:${s.id}`} data={{ type: 'stash', id: s.id }} kind={s.kind} title={s.title || 'Untitled'} blurb={KIND_LABEL[s.kind]} onAdd={() => onAddRemoved(s.id)} onDelete={() => onDelete(s.id)} />
              ))}
            </ul>
          </>
        )}
        <h3>Add new</h3>
        <ul>
          {TEMPLATES.map((t) => (
            <Item key={t.id} id={`tpl:${t.id}`} data={{ type: 'template', tid: t.id }} kind={t.kind} title={t.label} blurb={t.blurb} onAdd={() => onAddTemplate(t)} />
          ))}
        </ul>
      </div>
      <div className="drawer-drop" aria-hidden>Drop here to remove from CV</div>
    </aside>
  )
}
