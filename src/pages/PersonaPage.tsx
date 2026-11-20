import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createResume, deleteResume, getPersona, getResume, saveResume, updatePersona, type Persona, type ResumeDoc, type ResumeSummary } from '../api/client'
import { Avatar } from '../components/Avatar'
import { PageThumb } from '../components/CvView'
import { ImportPanel } from '../ai/ImportPanel'
import { PersonaForm } from '../components/PersonaForm'
import { Back, Copy, Edit, More, Trash, Upload } from '../components/icons'
import { Menu, MenuItem, MenuSep } from '../components/Popover'
import { layouts } from '../layouts/registry'
import { fullName } from '../model/format'
import { sampleResume } from '../model/sample'
import { personalOf } from '../model/types'

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (s < 60) return 'just now'
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  return rtf.format(-Math.round(s / 86400), 'day')
}

function CvCard({ cv, onDelete, onChanged }: { cv: ResumeSummary; onDelete: () => void; onChanged: () => void }) {
  const [doc, setDoc] = useState<ResumeDoc | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(cv.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let live = true
    getResume(cv.id).then((d) => live && setDoc(d)).catch(() => {})
    return () => {
      live = false
    }
  }, [cv.id, cv.version])
  useEffect(() => {
    if (renaming) input.current?.select()
  }, [renaming])

  // A CV's name is the headline written on it, so renaming edits that.
  const rename = async () => {
    const next = name.trim()
    setRenaming(false)
    if (!next || next === cv.title) return setName(cv.title)
    setBusy(true)
    try {
      const fresh = await getResume(cv.id)
      await saveResume(cv.id, { ...fresh.resume, basics: { ...fresh.resume.basics, headline: next } }, fresh.version)
      setError('')
      onChanged()
    } catch (e) {
      setName(cv.title)
      setError(e instanceof Error ? e.message : 'Could not rename the CV.')
    } finally {
      setBusy(false)
    }
  }
  const duplicate = async () => {
    setBusy(true)
    try {
      const fresh = await getResume(cv.id)
      await createResume(cv.personaId, { resume: { ...fresh.resume, basics: { ...fresh.resume.basics, headline: `${cv.title} (copy)` } }, layoutId: cv.layoutId })
      setError('')
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not duplicate the CV.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="lcard" aria-busy={busy}>
      <Link to={`/editor/${cv.id}`} className="lcard-thumb" aria-label={`Open ${cv.title}`}>
        {doc ? <PageThumb resume={doc.resume} /> : <div className="thumb" />}
        <span className="thumb-open" aria-hidden><span>Open</span></span>
      </Link>
      <div className="lcard-body">
        <div className="lcard-title">
          {renaming ? (
            <input
              ref={input}
              className="rename"
              value={name}
              maxLength={200}
              aria-label="CV name"
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'Escape') (setName(cv.title), setRenaming(false))
              }}
            />
          ) : (
            <h3 title={cv.title}>{cv.title}</h3>
          )}
          <Menu label={`Actions for ${cv.title}`} triggerClassName="icon-btn" trigger={<More />}>
            <MenuItem icon={<Edit />} onSelect={() => (setName(cv.title), setRenaming(true))}>Rename</MenuItem>
            <MenuItem icon={<Copy />} onSelect={() => void duplicate()}>Duplicate</MenuItem>
            <MenuSep />
            <MenuItem icon={<Trash />} danger onSelect={onDelete}>Delete…</MenuItem>
          </Menu>
        </div>
        <p>
          <span className="badge">{layouts.find((l) => l.id === cv.layoutId)?.name ?? cv.layoutId}</span> edited {ago(cv.updatedAt)}
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </article>
  )
}

/** One person: their details, their CVs, and a way to start another CV. */
export default function PersonaPage() {
  const { personaId = '' } = useParams()
  const nav = useNavigate()
  const [persona, setPersona] = useState<Persona | null>(null)
  const [cvs, setCvs] = useState<ResumeSummary[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [incoming, setIncoming] = useState<{ file: File; n: number } | undefined>()
  const [dragging, setDragging] = useState(false)
  // Sample thumbnails show this person's own details, so the choice looks like their CV.
  const samples = useMemo(() => {
    if (!persona) return []
    const { id: _id, resumeCount: _n, createdAt: _c, updatedAt: _u, ...details } = persona
    return layouts.map((l) => {
      const r = sampleResume(l.id)
      return { l, r: { ...r, basics: { ...r.basics, ...details } } }
    })
  }, [persona])

  // Drop a CV file anywhere on this page to import it. Only real file drags count (not dragged text or links).
  useEffect(() => {
    let depth = 0
    const files = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent) => { if (files(e)) { depth++; setDragging(true) } }
    const leave = (e: DragEvent) => { if (files(e) && --depth <= 0) { depth = 0; setDragging(false) } }
    const over = (e: DragEvent) => { if (files(e)) e.preventDefault() }
    const drop = (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) setIncoming((cur) => ({ file: f, n: (cur?.n ?? 0) + 1 }))
    }
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave); window.addEventListener('dragover', over); window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [])

  const load = useCallback(async () => {
    try {
      const d = await getPersona(personaId)
      setPersona(d.persona)
      setCvs(d.resumes)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
  }, [personaId])
  useEffect(() => {
    void load()
  }, [load])

  const create = async (layoutId: string, template: 'blank' | 'sample') => {
    setBusy(true)
    try {
      nav(`/editor/${(await createResume(personaId, { layoutId, template })).id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the CV.')
      setBusy(false)
    }
  }
  const removeCv = async (cv: ResumeSummary) => {
    if (!window.confirm(`Delete the CV “${cv.title}” permanently? This can’t be undone.`)) return
    await deleteResume(cv.id)
    await load()
  }
  if (error && !persona)
    return (
      <div className="state-box" role="alert">
        <h2>Couldn’t open this page</h2>
        <p>{error}</p>
        <p><Link className="btn" to="/">My CVs</Link></p>
      </div>
    )
  if (!persona) return <div className="state-box" aria-busy="true"><p>Loading…</p></div>

  const contact = [persona.email, persona.phone, persona.address.city].filter(Boolean).join(' · ')
  return (
    <div className="container home">
      <header className="persona-head">
        <Avatar id={persona.id} first={persona.firstName} last={persona.lastName} size={72} />
        <div className="persona-id">
          <h1>{fullName(persona)}</h1>
          <p>{contact || 'No contact details yet'}</p>
        </div>
        <div className="persona-actions">
          {!editing && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit details</button>}
        </div>
      </header>

      {editing && (
        <section className="panelbox" aria-label="Edit details">
          <h2>Details</h2>
          <p className="lede">Shared by all of {persona.firstName}’s CVs.</p>
          <PersonaForm
            initial={personalOf({ ...persona, headline: '' })}
            submitLabel="Save details"
            onSubmit={async (d) => {
              await updatePersona(persona.id, d)
              setEditing(false)
              await load()
            }}
            onCancel={() => setEditing(false)}
          />
        </section>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="block" aria-labelledby="cvs-h">
        <div className="section-head"><h2 id="cvs-h">{persona.firstName}’s CVs</h2></div>
        {cvs.length ? (
          <div className="lgrid">{cvs.map((cv) => <CvCard key={cv.id} cv={cv} onDelete={() => void removeCv(cv)} onChanged={() => void load()} />)}</div>
        ) : (
          <p className="empty">No CVs yet. Pick a layout below to start one.</p>
        )}
      </section>

      <section className="block" aria-labelledby="new-h">
        <div className="section-head">
          <h2 id="new-h">{cvs.length ? 'Create another CV' : 'Create a CV'}</h2>
          <p>Already have one? Drop it below. Otherwise choose a layout. You can switch later without losing anything.</p>
        </div>
        <ImportPanel persona={persona} incoming={incoming} />
        <div className="lgrid">
          {samples.map(({ l, r }) => (
            <article key={l.id} className="lcard">
              <button type="button" className="lcard-thumb" disabled={busy} onClick={() => void create(l.id, 'blank')} aria-label={`Start a new CV with the ${l.name} layout`}>
                <PageThumb resume={r} />
              </button>
              <div className="lcard-body">
                <h3>{l.name}</h3>
                <p>{l.description}</p>
                <div className="lcard-actions">
                  <button type="button" className="btn primary" disabled={busy} onClick={() => void create(l.id, 'blank')}>Use this layout</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void create(l.id, 'sample')}>With sample text</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {dragging && (
        <div className="page-drop" aria-hidden><div><Upload width={34} height={34} /><strong>Drop your CV to import it</strong><span>PDF, DOCX or HTML</span></div></div>
      )}
    </div>
  )
}
