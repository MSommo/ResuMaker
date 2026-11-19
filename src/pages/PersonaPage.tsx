import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createResume, deletePersona, deleteResume, getPersona, getResume, updatePersona, type Persona, type ResumeDoc, type ResumeSummary } from '../api/client'
import { Avatar } from '../components/Avatar'
import { PageThumb } from '../components/CvView'
import { PersonaForm } from '../components/PersonaForm'
import { Back, Trash } from '../components/icons'
import { layouts } from '../layouts/registry'
import { fullName } from '../model/format'
import { sampleResume } from '../model/sample'
import { rememberPersona } from '../state/ResumeContext'
import { personalOf } from '../model/types'

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (s < 60) return 'just now'
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  return rtf.format(-Math.round(s / 86400), 'day')
}

function CvCard({ cv, onDelete }: { cv: ResumeSummary; onDelete: () => void }) {
  const [doc, setDoc] = useState<ResumeDoc | null>(null)
  useEffect(() => {
    let live = true
    getResume(cv.id).then((d) => live && setDoc(d)).catch(() => {})
    return () => {
      live = false
    }
  }, [cv.id, cv.version])
  return (
    <article className="lcard">
      <Link to={`/editor/${cv.id}`} className="lcard-thumb" aria-label={`Open ${cv.title}`}>
        {doc ? <PageThumb resume={doc.resume} /> : <div className="thumb" />}
      </Link>
      <div className="lcard-body">
        <h3>{cv.title}</h3>
        <p>{layouts.find((l) => l.id === cv.layoutId)?.name ?? cv.layoutId} layout · edited {ago(cv.updatedAt)}</p>
        <div className="lcard-actions">
          <Link to={`/editor/${cv.id}`} className="btn">Open</Link>
          <button type="button" className="btn" onClick={onDelete} aria-label={`Delete ${cv.title}`}><Trash /> Delete</button>
        </div>
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
  const samples = useMemo(() => layouts.map((l) => ({ l, r: sampleResume(l.id) })), [])

  const load = useCallback(async () => {
    try {
      const d = await getPersona(personaId)
      setPersona(d.persona)
      setCvs(d.resumes)
      rememberPersona(d.persona.id, fullName(d.persona))
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
  const removePersona = async () => {
    if (!persona) return
    const n = cvs.length
    if (!window.confirm(`Delete ${fullName(persona)}${n ? ` and their ${n} CV${n > 1 ? 's' : ''}` : ''} permanently? This can’t be undone.`)) return
    await deletePersona(persona.id)
    try {
      localStorage.removeItem('resumaker:lastPersona')
      localStorage.removeItem('resumaker:lastId')
    } catch { /* ignore */ }
    nav('/')
  }

  if (error && !persona)
    return (
      <div className="state-box" role="alert">
        <h2>Couldn’t open this persona</h2>
        <p>{error}</p>
        <p><Link className="btn" to="/">Everyone</Link></p>
      </div>
    )
  if (!persona) return <div className="state-box" aria-busy="true"><p>Loading…</p></div>

  const contact = [persona.email, persona.phone, persona.address.city].filter(Boolean).join(' · ')
  return (
    <div className="container home">
      <Link to="/" className="back"><Back /> Everyone</Link>

      <header className="persona-head">
        <Avatar id={persona.id} first={persona.firstName} last={persona.lastName} size={72} />
        <div className="persona-id">
          <h1>{fullName(persona)}</h1>
          <p>{contact || 'No contact details yet'}</p>
        </div>
        <div className="persona-actions">
          {!editing && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit details</button>}
          <button type="button" className="btn" onClick={() => void removePersona()}><Trash /> Delete persona</button>
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
          <div className="lgrid">{cvs.map((cv) => <CvCard key={cv.id} cv={cv} onDelete={() => void removeCv(cv)} />)}</div>
        ) : (
          <p className="empty">No CVs yet. Pick a layout below to start one.</p>
        )}
      </section>

      <section className="block" aria-labelledby="new-h">
        <div className="section-head">
          <h2 id="new-h">{cvs.length ? 'Create another CV' : 'Create a CV'}</h2>
          <p>Choose a layout. You can switch later without losing anything.</p>
        </div>
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
    </div>
  )
}
