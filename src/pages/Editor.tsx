import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, MouseSensor, TouchSensor, closestCenter, pointerWithin, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useCaps } from '../api/Caps'
import { ChatBubble } from '../ai/ChatBubble'
import { LockedAssistant } from '../ai/Upgrade'
import { CvViewport, PageThumb } from '../components/CvView'
import { Menu, MenuItem, MenuSep } from '../components/Popover'
import { PdfButton } from '../components/PdfButton'
import { Back, Close, Download, Expand, Layers, Layout, Plus, Print, Upload } from '../components/icons'
import { Drawer } from '../editor/Drawer'
import { type Active, type DragData, type DragState, type Slot, listEl, sameSlot, slotIndex } from '../editor/dnd'
import { PersonalForm } from '../editor/PersonalForm'
import { SectionEditor } from '../editor/SectionEditor'
import { CardFace, HeaderBlock, ZoneBox, type Landing } from '../editor/Structure'
import { HeaderEditor } from '../editor/HeaderEditor'
import { layouts, getLayout } from '../layouts/registry'
import { fullName } from '../model/format'
import { zoneSections, stashed } from '../model/sections'
import { TEMPLATES, getTemplate, type Template } from '../model/templates'
import type { Resume, Section } from '../model/types'
import { pickZone, place, stash, zoneAccepts } from '../state/ops'
import { parseImport } from '../state/storage'
import { useResume } from '../state/ResumeContext'

const SAVE_LABEL = { saved: 'Saved', saving: 'Saving…', error: 'Couldn’t save. Retrying on your next edit', conflict: 'Reloaded: this CV changed elsewhere' } as const

// Only columns and the drawer are drop targets (where in a column is worked out from the card's position, see dnd.ts).
// Prefer the one under the pointer; fall back to the nearest one (keyboard dragging).
const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : closestCenter(args)
}

// Columns grow and shrink while a gap moves through them: keep their drop areas measured.
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } }

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
      <button type="button" className="btn small tb-layout" onClick={() => setOpen(true)} aria-haspopup="dialog" title="Change layout">
        <Layout /> <span className="tb-ellipsis">{getLayout(resume.layoutId).name}</span>
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
  useEffect(() => { if (tab !== 'sections') setDrawer(false) }, [tab]) // the drawer holds section components: it belongs to the Sections tab
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [drag, setDragState] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null) // the same, read synchronously by the drag handlers
  const setDrag = (d: DragState | null) => ((dragRef.current = d), setDragState(d))
  const landing: Landing = useRef(null)
  const active = drag?.data ?? null
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
    useSensor(KeyboardSensor),
  )

  const selected = resume.sections.find((s) => s.id === selectedId) ?? null
  const headerOpen = selectedId === '@header'
  const removed = useMemo(() => stashed(resume), [resume])

  const infoOf = (d: DragData): Active | null => {
    const s = d.type === 'template' ? getTemplate(d.tid)?.make() : resume.sections.find((x) => x.id === d.id)
    return s ? { id: d.type === 'template' ? null : s.id, kind: s.kind, icon: s.icon, from: d.type === 'section' ? s.zone : null } : null
  }

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData | undefined
    const info = data && infoOf(data)
    if (!data || !info) return
    const list = info.from ? zoneSections(resume, info.from) : []
    const origin: Slot | null = info.from ? { zone: info.from, index: list.findIndex((s) => s.id === info.id) } : null
    // The gap is as tall as the card being moved; a new one is as tall as the cards already in the columns.
    const height = data.type === 'section' ? e.active.rect.current.initial?.height ?? 50 : document.querySelector<HTMLElement>('.zone-list [data-slot]')?.offsetHeight ?? 50
    setDrag({ data, info, origin, at: origin, overDrawer: false, height })
  }
  const onDragMove = (e: DragMoveEvent) => {
    const d = dragRef.current
    if (!d) return
    const over = e.over ? String(e.over.id) : null
    const zone = over?.startsWith('zone:') ? over.slice(5) : null
    let at: Slot | null = d.origin // not over a column that takes it: it would go back where it was
    const box = e.active.rect.current.translated
    const list = zone && zoneAccepts(layout, zone, d.info.kind, d.info.icon) ? listEl(zone) : null
    if (over === 'drawer') at = null
    else if (zone && list && box) at = { zone, index: slotIndex(list, box.top + box.height / 2) }
    const overDrawer = over === 'drawer'
    if (!sameSlot(at, d.at) || overDrawer !== d.overDrawer) setDrag({ ...d, at, overDrawer })
  }
  const onDragEnd = (e: DragEndEvent) => {
    const d = dragRef.current
    const box = e.active.rect.current.translated
    setDrag(null)
    if (!d) return
    if (d.overDrawer) {
      if (d.data.type === 'section') setResume((r) => ({ ...r, sections: stash(r.sections, (d.data as { id: string }).id) }))
      return
    }
    const at = d.at
    if (!at) return
    const sec = d.data.type === 'template' ? getTemplate(d.data.tid)?.make() : resume.sections.find((s) => s.id === (d.data as { id: string }).id)
    if (!sec || !zoneAccepts(layout, at.zone, sec.kind, sec.icon)) return
    // The card glides from where it was let go into its place (also when that place is where it came from).
    if (box) {
      landing.current = { id: sec.id, left: box.left, top: box.top }
      setTimeout(() => (landing.current = null), 500)
    }
    if (sameSlot(at, d.origin)) return
    setResume((r) => {
      const rest = r.sections.filter((s) => s.zone === at.zone && s.id !== sec.id)
      return { ...r, sections: place(r.sections, sec, at.zone, rest[at.index]?.id ?? null) }
    })
  }

  // Clicking a part of the rendered CV opens that section (the header opens the Header card, personal details open Personal info).
  const openFromPreview = (id: string) => {
    const sec = resume.sections.find((x) => x.id === id)
    if (id === '@info') {
      setTab('sections')
      setSelectedId('@header')
    } else if (sec?.kind === 'details') {
      setSelectedId(null)
      setTab('info')
    } else if (sec) {
      setTab('sections')
      setSelectedId(id)
    } else return
    setView('edit')
  }

  const addTemplate = (t: Template) => {
    const made = t.make()
    const zone = pickZone(layout, made.kind, t.zone, made.icon)
    if (zone) setResume((r) => ({ ...r, sections: place(r.sections, made, zone, null) }))
  }
  const addRemoved = (id: string) =>
    setResume((r) => {
      const sec = r.sections.find((s) => s.id === id)
      const zone = sec && pickZone(layout, sec.kind, undefined, sec.icon)
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
    <DndContext sensors={sensors} collisionDetection={collide} measuring={MEASURING} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => setDrag(null)}>
      <div className="editor" data-view={view} data-drawer={drawer ? "open" : "closed"}>
        <aside className="ed-panel no-print">
          {headerOpen && tab === 'sections' ? (
            <div className="ed-body">
              <HeaderEditor onBack={() => setSelectedId(null)} goInfo={() => (setSelectedId(null), setTab('info'))} />
            </div>
          ) : selected && tab === 'sections' ? (
            <div className="ed-body">
              <SectionEditor sec={selected} onBack={() => setSelectedId(null)} goInfo={() => (setSelectedId(null), setTab('info'))} />
            </div>
          ) : (
            <>
              <div className="ed-tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'info'} onClick={() => setTab('info')}>Personal info</button>
                <button role="tab" aria-selected={tab === 'sections'} onClick={() => setTab('sections')}>Sections</button>
                {tab === 'sections' && (
                  <button type="button" className={`btn small ${drawer ? 'primary' : ''}`} onClick={() => setDrawer((d) => !d)} aria-expanded={drawer}>
                    <Plus /> Components
                  </button>
                )}
              </div>
              <div className="ed-body">
                {tab === 'info' ? (
                  <PersonalForm />
                ) : (
                  <div className="zones">
                    <HeaderBlock zone={layout.zones.find((z) => z.id === 'header')} sections={zoneSections(resume, 'header')} drag={drag} landing={landing} onSelectHeader={() => setSelectedId('@header')} onSelect={setSelectedId} onStash={stashOne} />
                    {layout.zones.filter((z) => z.id !== 'header').map((z) => (
                      <ZoneBox key={z.id} zone={z} sections={zoneSections(resume, z.id)} drag={drag} landing={landing} onSelect={setSelectedId} onStash={stashOne} />
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
            <Link className="btn small soft" to={`/p/${personaId}`} title="Back to all of your CVs"><Back /> <span className="tb-label">All CVs</span></Link>
            <LayoutPicker resume={resume} onPick={setLayout} />
            <span className="tb-grow" />
            {notice && <span className="tb-notice" role="status">{notice}</span>}
            <span className={`save-state ${saveState}`} role="status">{SAVE_LABEL[saveState]}</span>
            <Link className="btn small" to={`/preview/${id}`} title="Full preview"><Expand /> <span className="tb-label">Full preview</span></Link>
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
          <CvViewport resume={resume} className="ed-viewport" onSelectSection={openFromPreview} activeSection={headerOpen ? '@info' : tab === 'info' ? resume.sections.find((s) => s.kind === 'details' && s.zone !== null)?.id : selectedId} />
        </section>

        <nav className="mobile-tabs no-print" aria-label="Editor view">
          <button aria-pressed={view === 'edit'} onClick={() => setView('edit')}>Edit</button>
          <button aria-pressed={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
        </nav>
      </div>
      <DragOverlay dropAnimation={null}>{overlay}</DragOverlay>
      {caps.ai ? <ChatBubble /> : caps.aiLocked && <LockedAssistant />}
    </DndContext>
  )
}
