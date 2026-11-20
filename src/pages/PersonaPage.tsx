import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createResume, deleteResume, getPersona, getResume, renameResume, updatePersona, type Persona, type ResumeDoc, type ResumeSummary } from '../api/client'
import { PageThumb } from '../components/CvView'
import { ImportPanel } from '../ai/ImportPanel'
import { UpgradeNote } from '../ai/Upgrade'
import { useCaps } from '../api/Caps'
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

type Work = 'rename' | 'duplicate' | 'delete'
const WORKING: Record<Work, string> = { rename: 'Renaming…', duplicate: 'Making a copy…', delete: 'Deleting…' }

function CvCard({ cv, onDelete, onChanged }: { cv: ResumeSummary; onDelete: () => Promise<void>; onChanged: () => void }) {
  const [doc, setDoc] = useState<ResumeDoc | null>(null)
  const [thumbFailed, setThumbFailed] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(cv.name)
  const [work, setWork] = useState<Work | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let live = true
    setThumbFailed(false)
    getResume(cv.id).then((d) => live && setDoc(d)).catch(() => live && setThumbFailed(true))
    return () => {
      live = false
    }
  }, [cv.id, cv.version])
  useEffect(() => {
    if (renaming) input.current?.select()
  }, [renaming])
  useEffect(() => {
    if (confirming) keep.current?.focus() // the safe choice has focus, so Enter never deletes by accident
  }, [confirming])

  // Runs one action at a time; a failure leaves the CV as it was and says so in the card.
  const run = async (what: Work, job: () => Promise<void>, failed: string) => {
    setWork(what)
    setError('')
    try {
      await job()
    } catch (e) {
      setError(`${failed} ${e instanceof Error ? e.message : ''}`.trim())
    } finally {
      setWork(null)
    }
  }

  // The name only tells your CVs apart: it is never printed, so renaming doesn't touch the CV (the headline is edited in
  // the editor). Clearing it shows the headline again.
  const rename = () => {
    const next = name.trim()
    setRenaming(false)
    if (next === cv.name) return setName(cv.name)
    void run('rename', async () => {
      try {
        await renameResume(cv.id, next)
        onChanged()
      } catch (e) {
        setName(cv.name)
        throw e
      }
    }, 'Couldn’t rename the CV.')
  }
  const duplicate = () =>
    void run('duplicate', async () => {
      const fresh = await getResume(cv.id)
      // The copy prints the same headline; only its name says it's a copy.
      await createResume(cv.personaId, { resume: fresh.resume, layoutId: cv.layoutId, name: `${cv.title} (copy)`.slice(0, 100) })
      onChanged()
    }, 'Couldn’t make a copy.')
  const remove = () => {
    setConfirming(false)
    void run('delete', onDelete, 'Couldn’t delete the CV; it is still here.')
  }

  const busy = work !== null
  return (
    <article className={`lcard ${busy ? 'busy' : ''}`} aria-busy={busy}>
      {/* The link covers the preview instead of wrapping it: the preview has links of its own (LinkedIn…), and a link can't hold links. */}
      <div className="lcard-thumb">
        {doc ? <PageThumb resume={doc.resume} /> : <div className="thumb">{thumbFailed && <span className="thumb-missing">Preview unavailable</span>}</div>}
        <Link to={`/editor/${cv.id}`} className="thumb-hit" aria-label={`Open ${cv.title}`}>
          <span className="thumb-open" aria-hidden><span>Open</span></span>
        </Link>
      </div>
      <div className="lcard-body">
        <div className="lcard-title">
          {renaming ? (
            <input
              ref={input}
              className="rename"
              value={name}
              maxLength={100}
              placeholder={cv.headline || 'Untitled CV'}
              aria-label="CV name, only you see it"
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'Escape') (setName(cv.name), setRenaming(false))
              }}
            />
          ) : (
            <h3 title={cv.title}>{cv.title}</h3>
          )}
          <Menu label={`Actions for ${cv.title}`} triggerClassName="icon-btn" trigger={<More />}>
            <MenuItem icon={<Edit />} disabled={busy} onSelect={() => (setName(cv.name), setRenaming(true))}>Rename</MenuItem>
            <MenuItem icon={<Copy />} disabled={busy} onSelect={duplicate}>Duplicate</MenuItem>
            <MenuSep />
            <MenuItem icon={<Trash />} danger disabled={busy} onSelect={() => setConfirming(true)}>Delete…</MenuItem>
          </Menu>
        </div>
        {renaming && <p className="lcard-hint">Only you see this name: it isn’t printed on the CV. Leave it empty to show the headline. Enter saves, Esc cancels.</p>}
        {!renaming && cv.name && cv.headline && <p className="lcard-sub" title="Headline printed on this CV">{cv.headline}</p>}
        <p className="lcard-meta">
          <span className="badge">{layouts.find((l) => l.id === cv.layoutId)?.name ?? cv.layoutId}</span>
          <span>Edited {ago(cv.updatedAt)}</span>
        </p>
        <p className="lcard-status" role="status">{work ? WORKING[work] : ''}</p>
        {confirming && (
          <div className="lcard-confirm" role="group" aria-label={`Delete ${cv.title}`}>
            <p>Delete this CV for good? This can’t be undone.</p>
            <div>
              <button type="button" className="btn small danger" onClick={remove}>Delete CV</button>
              <button ref={keep} type="button" className="btn small" onClick={() => setConfirming(false)} onKeyDown={(e) => e.key === 'Escape' && setConfirming(false)}>Keep it</button>
            </div>
          </div>
        )}
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
  const [createError, setCreateError] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [incoming, setIncoming] = useState<{ file: File; n: number } | undefined>()
  const [dragging, setDragging] = useState(false)
  const caps = useCaps()
  const canImport = caps.ai
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
  // Importing reads the file with AI, so without AI there is nothing to drop onto.
  useEffect(() => {
    if (!canImport) return
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
  }, [canImport])

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
    setCreateError('')
    try {
      nav(`/editor/${(await createResume(personaId, { layoutId, template })).id}`)
    } catch (e) {
      setCreateError(`Couldn’t create the CV. ${e instanceof Error ? e.message : ''}`.trim())
      setBusy(false)
    }
  }
  // Errors are shown by the card (deleteResume throws); the list only reloads once the CV is really gone.
  const removeCv = async (cv: ResumeSummary) => {
    await deleteResume(cv.id)
    await load()
  }
  if (error && !persona)
    return (
      <div className="state-box" role="alert">
        <h2>Couldn’t load your CVs</h2>
        <p>{error}</p>
        <p><button type="button" className="btn primary" onClick={() => (setError(''), void load())}>Try again</button></p>
      </div>
    )
  if (!persona) return <div className="state-box" aria-busy="true"><p>Loading your CVs…</p></div>

  // The details every CV prints (the navbar already says who is signed in, so no avatar here).
  const details = [fullName(persona), persona.email, persona.phone, persona.address.city].filter(Boolean)
  const fresh = !cvs.length
  return (
    <div className="container home">
      <header className="page-head">
        <h1>My CVs</h1>
        <p className="persona-meta">
          {details.length > 1 ? (
            <span><span className="sr-only">On every CV: </span>{details.join(' · ')}</span>
          ) : (
            <span>Add your name and contact details once: every CV you make uses them.</span>
          )}
          {!editing && <button type="button" className="link" onClick={() => setEditing(true)}>{details.length > 1 ? 'Edit details' : 'Add details'}</button>}
        </p>
      </header>

      {editing && (
        <section className="panelbox" aria-label="Edit details">
          <h2>Details</h2>
          <p className="lede">Shared by all your CVs: change them here once.</p>
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

      {/* With no CVs yet there is nothing to list: the page goes straight to starting the first one. */}
      {!fresh && (
        <section className="block" aria-label="Your CVs">
          <div className="lgrid">{cvs.map((cv) => <CvCard key={cv.id} cv={cv} onDelete={() => removeCv(cv)} onChanged={() => void load()} />)}</div>
        </section>
      )}

      <section className={`block ${fresh ? 'first-run' : ''}`} aria-labelledby="new-h">
        <div className="section-head">
          <h2 id="new-h">{fresh ? 'Start your first CV' : 'Create another CV'}</h2>
          <p>
            {/* Importing needs AI: without it on the server, only layouts are offered. */}
            {!(caps.ai || caps.aiLocked)
              ? 'Start from a layout. You can switch layouts later without losing anything.'
              : fresh
                ? 'Import a CV you already have and it’s ready to edit in a minute, or start from a layout. You can switch layouts later without losing anything.'
                : 'Import a CV you already have, or start from a layout. You can switch layouts later without losing anything.'}
          </p>
        </div>
        {caps.ai ? <ImportPanel persona={persona} incoming={incoming} /> : caps.aiLocked && <UpgradeNote feature="Importing a CV" />}
        <h3 className="sub-head">Start from a layout</h3>
        {createError && <p className="form-error" role="alert">{createError}</p>}
        <div className="lgrid">
          {samples.map(({ l, r }) => (
            <article key={l.id} className="lcard">
              <div className="lcard-thumb">
                <PageThumb resume={r} />
                {/* A bigger target for the pointer; keyboard and screen readers use "Use this layout" below. */}
                <button type="button" className="thumb-hit" tabIndex={-1} aria-hidden disabled={busy} onClick={() => void create(l.id, 'blank')} />
              </div>
              <div className="lcard-body">
                <h3>{l.name}</h3>
                <p>{l.description}</p>
                <div className="lcard-actions">
                  {/* The preview shows sample text; say plainly which start keeps it. */}
                  <button type="button" className="btn primary" disabled={busy} onClick={() => void create(l.id, 'blank')} aria-label={`Start a blank CV with the ${l.name} layout`}>Start blank</button>
                  <button type="button" className="link" disabled={busy} onClick={() => void create(l.id, 'sample')} aria-label={`Start a ${l.name} CV with the sample text shown`}>or keep the sample text</button>
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
