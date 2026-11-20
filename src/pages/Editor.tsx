import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, pointerWithin, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useCaps } from '../api/Caps'
import { ChatBubble } from '../ai/ChatBubble'
import { CvViewport, PageThumb } from '../components/CvView'
import { Menu, MenuItem, MenuSep } from '../components/Popover'
import { PdfButton } from '../components/PdfButton'
import { Back, Close, Download, Expand, Layers, Layout, Plus, Print, Upload } from '../components/icons'
import { Drawer } from '../editor/Drawer'
import { type DragData, resolveOver } from '../editor/dnd'
import { PersonalForm } from '../editor/PersonalForm'
import { SectionEditor } from '../editor/SectionEditor'
import { CardFace, ZoneBox } from '../editor/Structure'
import { layouts, getLayout } from '../layouts/registry'
import { fullName } from '../model/format'
import { zoneSections, stashed } from '../model/sections'
import { TEMPLATES, getTemplate, type Template } from '../model/templates'
import type { Resume, Section, SectionKind } from '../model/types'
import { pickZone, place, stash, zoneAccepts } from '../state/ops'
import { parseImport } from '../state/storage'
import { useResume } from '../state/ResumeContext'

const SAVE_LABEL = { saved: 'Saved', saving: 'Saving…', error: 'Couldn’t save. Retrying on your next edit', conflict: 'Reloaded: this CV changed elsewhere' } as const

// Prefer the element under the pointer; fall back to the nearest one (keyboard dragging).
const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : closestCenter(args)
}

/** Renders its children only once it scrolls into view, so a gallery with many layouts doesn't lay out every CV at once. */
function WhenVisible({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && (setSeen(true), io.disconnect()), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return <span ref={ref} className="when-visible">{seen ? children : null}</span>
}

/** Full-size modal (90% of the window) to choose a layout: each card shows this CV rendered in that layout. Searchable, since the list will grow. */
function LayoutGallery({ resume, onPick, onClose }: { resume: Resume; onPick: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [q, setQ] = useState('')
  const current = getLayout(resume.layoutId)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal() // native modal: focus trap, Escape and inert background come with it
  }, [])
  const shown = layouts.filter((l) => `${l.name} ${l.description}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <dialog ref={ref} className="gallery" aria-labelledby="gallery-title" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <header className="gallery-head">
        <h2 id="gallery-title">Choose a layout</h2>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), ref.current?.close())} placeholder="Search layouts…" aria-label="Search layouts" autoFocus />
        <span className="tb-grow" />
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close"><Close /></button>
      </header>
      <div className="gallery-body">
        <div className="gallery-grid" role="radiogroup" aria-label="Layouts">
          {shown.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={l.id === current.id} className={`gl-item ${l.id === current.id ? 'on' : ''}`} onClick={() => (l.id !== current.id && onPick(l.id), ref.current?.close())}>
              <span className="gl-thumb"><WhenVisible><PageThumb resume={{ ...resume, layoutId: l.id }} /></WhenVisible></span>
              <span className="gl-name"><strong>{l.name}</strong>{l.id === current.id && <span className="badge">Current</span>}</span>
              <small>{l.description}</small>
            </button>
          ))}
          {!shown.length && <p className="empty">No layout matches “{q}”.</p>}
        </div>
      </div>
    </dialog>
  )
}

function LayoutPicker({ resume, onPick }: { resume: Resume; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn small" onClick={() => setOpen(true)} aria-haspopup="dialog" title="Change layout">
        <Layout /> {getLayout(resume.layoutId).name}
      </button>
      {open && <LayoutGallery resume={resume} onPick={onPick} onClose={() => setOpen(false)} />}
    </>
  )
}

export default function EditorPage() {
  const { id, personaId, resume, setResume, setLayout, replace, reset, saveState } = useResume()
  const caps = useCaps()
  const layout = getLayout(resume.layoutId)
  const [tab, setTab] = useState<'info' | 'sections'>('sections')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [active, setActive] = useState<DragData | null>(null)
  const [overZone, setOverZone] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Escape closes the components drawer (unless a popover or a drag already took it).
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !active && !document.querySelector('dialog[open]') && setDrawer(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer, active])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const selected = resume.sections.find((s) => s.id === selectedId) ?? null
  const removed = useMemo(() => stashed(resume), [resume])

  const kindOf = (d: DragData | null): SectionKind | null => {
    if (!d) return null
    if (d.type === 'template') return getTemplate(d.tid)?.kind ?? null
    return resume.sections.find((s) => s.id === d.id)?.kind ?? null
  }

  const onDragStart = (e: DragStartEvent) => setActive((e.active.data.current as DragData) ?? null)
  const onDragOver = (e: DragOverEvent) => {
    const t = e.over ? resolveOver(String(e.over.id), resume.sections) : null
    setOverZone(t ? ('drawer' in t && t.drawer ? 'drawer' : (t as { zone: string }).zone) : null)
  }
  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as DragData | undefined
    setActive(null)
    setOverZone(null)
    if (!data || !e.over) return
    const target = resolveOver(String(e.over.id), resume.sections)
    if (!target) return
    setResume((r) => {
      if ('drawer' in target && target.drawer) return data.type === 'section' ? { ...r, sections: stash(r.sections, data.id) } : r
      const { zone, overId } = target as { zone: string; overId: string | null }
      if (overId && data.type !== 'template' && overId === data.id) return r
      const sec = data.type === 'template' ? getTemplate(data.tid)?.make() : r.sections.find((s) => s.id === data.id)
      if (!sec || !zoneAccepts(layout, zone, sec.kind)) return r
      return { ...r, sections: place(r.sections, sec, zone, overId) }
    })
  }

  // Clicking a part of the rendered CV opens that section (the header opens Personal info).
  const openFromPreview = (id: string) => {
    const sec = resume.sections.find((x) => x.id === id)
    if (id === '@info' || sec?.kind === 'details') {
      setSelectedId(null)
      setTab('info')
    } else if (sec) {
      setTab('sections')
      setSelectedId(id)
    } else return
    setView('edit')
  }

  const addTemplate = (t: Template) => {
    const zone = pickZone(layout, t.kind, t.zone)
    if (zone) setResume((r) => ({ ...r, sections: place(r.sections, t.make(), zone, null) }))
  }
  const addRemoved = (id: string) =>
    setResume((r) => {
      const sec = r.sections.find((s) => s.id === id)
      const zone = sec && pickZone(layout, sec.kind)
      return sec && zone ? { ...r, sections: place(r.sections, sec, zone, null) } : r
    })
  const stashOne = (id: string) => setResume((r) => ({ ...r, sections: stash(r.sections, id) }))
  const deleteOne = (id: string) => {
    const s = resume.sections.find((x) => x.id === id)
    if (s && window.confirm(`Delete “${s.title}” and its content permanently?`)) {
      setResume((r) => ({ ...r, sections: r.sections.filter((x) => x.id !== id) }))
      if (selectedId === id) setSelectedId(null)
    }
  }

  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(resume, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${fullName(resume.basics) || 'resume'}-cv.json`.toLowerCase().replace(/\s+/g, '-')
    a.click()
    URL.revokeObjectURL(url)
  }
  const importJson = async (file?: File) => {
    if (!file) return
    try {
      replace(parseImport(await file.text()))
      setSelectedId(null)
      setNotice('Imported.')
    } catch {
      setNotice('That file is not a valid ResuMaker export.')
    }
    if (fileRef.current) fileRef.current.value = ''
    setTimeout(() => setNotice(''), 4000)
  }

  const overlay = (() => {
    if (!active) return null
    const sec: Section | undefined = active.type === 'template' ? undefined : resume.sections.find((s) => s.id === active.id)
    const tpl = active.type === 'template' ? TEMPLATES.find((t) => t.id === active.tid) : undefined
    if (sec) return <div className="card overlay"><CardFace sec={sec} /></div>
    if (tpl) return <div className="card overlay"><CardFace sec={{ ...tpl.make() }} /></div>
    return null
  })()

  return (
    <DndContext sensors={sensors} collisionDetection={collide} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => (setActive(null), setOverZone(null))}>
      <div className="editor" data-view={view} data-drawer={drawer ? "open" : "closed"}>
        <aside className="ed-panel no-print">
          {selected && tab === 'sections' ? (
            <div className="ed-body">
              <SectionEditor sec={selected} onBack={() => setSelectedId(null)} goInfo={() => (setSelectedId(null), setTab('info'))} />
            </div>
          ) : (
            <>
              <div className="ed-tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'info'} onClick={() => setTab('info')}>Personal info</button>
                <button role="tab" aria-selected={tab === 'sections'} onClick={() => setTab('sections')}>Sections</button>
                <button type="button" className={`btn small ${drawer ? 'primary' : ''}`} onClick={() => setDrawer((d) => !d)} aria-expanded={drawer}>
                  <Plus /> Components
                </button>
              </div>
              <div className="ed-body">
                {tab === 'info' ? (
                  <PersonalForm />
                ) : (
                  <div className="zones">
                    {layout.zones.map((z) => (
                      <ZoneBox key={z.id} zone={z} sections={zoneSections(resume, z.id)} activeKind={kindOf(active)} overZone={overZone} onSelect={setSelectedId} onStash={stashOne} />
                    ))}
                    {removed.length > 0 && (
                      <p className="zones-note">
                        <Layers /> {removed.length} removed {removed.length === 1 ? 'section is' : 'sections are'} kept in <button type="button" className="link" onClick={() => setDrawer(true)}>Components</button>.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>

        <Drawer open={drawer} onClose={() => setDrawer(false)} removed={removed} onAddTemplate={addTemplate} onAddRemoved={addRemoved} onDelete={deleteOne} />

        <section className="ed-stage">
          <div className="ed-toolbar no-print">
            <Link className="btn small" to={`/p/${personaId}`} title="All of this person’s CVs"><Back /> {resume.basics.firstName || 'CVs'}</Link>
            <LayoutPicker resume={resume} onPick={setLayout} />
            <span className="tb-grow" />
            {notice && <span className="tb-notice" role="status">{notice}</span>}
            <span className={`save-state ${saveState}`} role="status">{SAVE_LABEL[saveState]}</span>
            <Link className="btn small" to={`/preview/${id}`}><Expand /> Full preview</Link>
            <PdfButton />
            <Menu>
              <MenuItem icon={<Print />} onSelect={() => window.print()}>Print…</MenuItem>
              <MenuItem icon={<Download />} onSelect={exportJson}>Export JSON</MenuItem>
              <MenuItem icon={<Upload />} onSelect={() => fileRef.current?.click()}>Import JSON</MenuItem>
              <MenuSep />
              <MenuItem danger onSelect={() => window.confirm('Clear all content and start with an empty CV?') && (reset(), setSelectedId(null))}>Start from empty CV…</MenuItem>
            </Menu>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
          </div>
          <CvViewport resume={resume} className="ed-viewport" onSelectSection={openFromPreview} activeSection={tab === 'info' ? '@info' : selectedId} />
        </section>

        <nav className="mobile-tabs no-print" aria-label="Editor view">
          <button aria-pressed={view === 'edit'} onClick={() => setView('edit')}>Edit</button>
          <button aria-pressed={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
        </nav>
      </div>
      <DragOverlay dropAnimation={null}>{overlay}</DragOverlay>
      {caps.ai && <ChatBubble />}
    </DndContext>
  )
}
