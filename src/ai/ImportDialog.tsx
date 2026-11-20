import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, createResume, importCv, updatePersona, type ImportPreview, type Persona } from '../api/client'
import { Close, Sparkle } from '../components/icons'
import { personalOf, type PersonalDetails } from '../model/types'

const MAX_MB = 10
type Stage = 'pick' | 'reading' | 'review' | 'creating'

const FIELDS: { key: string; label: string; get: (d: PersonalDetails) => string; set: (d: PersonalDetails, v: string) => PersonalDetails }[] = [
  { key: 'firstName', label: 'First name', get: (d) => d.firstName, set: (d, v) => ({ ...d, firstName: v }) },
  { key: 'lastName', label: 'Last name', get: (d) => d.lastName, set: (d, v) => ({ ...d, lastName: v }) },
  { key: 'email', label: 'Email', get: (d) => d.email, set: (d, v) => ({ ...d, email: v }) },
  { key: 'phone', label: 'Phone', get: (d) => d.phone, set: (d, v) => ({ ...d, phone: v }) },
  { key: 'street', label: 'Street', get: (d) => d.address.street, set: (d, v) => ({ ...d, address: { ...d.address, street: v } }) },
  { key: 'city', label: 'City', get: (d) => d.address.city, set: (d, v) => ({ ...d, address: { ...d.address, city: v } }) },
  { key: 'postcode', label: 'Postcode', get: (d) => d.address.postcode, set: (d, v) => ({ ...d, address: { ...d.address, postcode: v } }) },
  { key: 'country', label: 'Country', get: (d) => d.address.country, set: (d, v) => ({ ...d, address: { ...d.address, country: v } }) },
  { key: 'birthDate', label: 'Date of birth', get: (d) => d.birthDate, set: (d, v) => ({ ...d, birthDate: v }) },
  { key: 'birthPlace', label: 'Place of birth', get: (d) => d.birthPlace, set: (d, v) => ({ ...d, birthPlace: v }) },
  { key: 'nationality', label: 'Nationality', get: (d) => d.nationality, set: (d, v) => ({ ...d, nationality: v }) },
]

/**
 * Import a CV from a PDF, DOCX or HTML file. The file is read by the assistant into our format and shown for review (warnings,
 * what was found, and any personal details that differ from this person's). Nothing is created until you confirm.
 */
export function ImportDialog({ persona, onClose }: { persona: Persona; onClose: () => void }) {
  const nav = useNavigate()
  const [stage, setStage] = useState<Stage>('pick')
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [use, setUse] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const current = useMemo(() => personalOf({ ...persona, headline: '' }), [persona])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stage !== 'creating' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const close = () => {
    abort.current?.abort()
    onClose()
  }

  const diffs = useMemo(() => (preview ? FIELDS.filter((f) => f.get(preview.resume.basics).trim() && f.get(preview.resume.basics) !== f.get(current)) : []), [preview, current])

  const read = async (file: File) => {
    setError('')
    if (file.size > MAX_MB * 1024 * 1024) return setError(`That file is larger than ${MAX_MB} MB.`)
    setFileName(file.name)
    setStage('reading')
    abort.current = new AbortController()
    try {
      const p = await importCv(persona.id, file, abort.current.signal)
      setPreview(p)
      // Fill gaps by default; never overwrite something already there unless you tick it.
      setUse(new Set(FIELDS.filter((f) => f.get(p.resume.basics).trim() && !f.get(current).trim()).map((f) => f.key)))
      setStage('review')
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.')
      setStage('pick')
    }
  }

  const create = async () => {
    if (!preview) return
    setStage('creating')
    try {
      if (use.size) {
        let d = current
        for (const f of FIELDS) if (use.has(f.key)) d = f.set(d, f.get(preview.resume.basics))
        await updatePersona(persona.id, d)
      }
      const doc = await createResume(persona.id, { resume: preview.resume })
      onClose()
      nav(`/editor/${doc.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the CV.')
      setStage('review')
    }
  }

  return (
    <div className="modal-backdrop no-print" role="presentation">
      <section className="modal tailor import" role="dialog" aria-label="Import a CV">
        <header>
          <h2><Sparkle /> Import a CV</h2>
          <span className="tb-grow" />
          <button type="button" className="icon-btn" onClick={close} aria-label="Close" disabled={stage === 'creating'}><Close /></button>
        </header>

        {(stage === 'pick' || stage === 'reading') && (
          <>
            <p className="tailor-help">Choose a CV as <strong>PDF, DOCX or HTML</strong> (up to {MAX_MB} MB). I’ll read it into an editable CV for {persona.firstName} and show you what I found before anything is created. Old <code>.doc</code> files: save them as DOCX or PDF first.</p>
            <label
              className={`dropzone ${drag ? 'over' : ''} ${stage === 'reading' ? 'busy' : ''}`}
              onDragOver={(e) => (e.preventDefault(), setDrag(true))}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                const f = e.dataTransfer.files?.[0]
                if (f && stage === 'pick') void read(f)
              }}
            >
              {stage === 'reading' ? <span className="ai-status"><Sparkle className="spin" /> Reading {fileName}…</span> : <span>Drop a file here, or <u>browse</u></span>}
              <input type="file" accept=".pdf,.docx,.html,.htm,application/pdf" disabled={stage === 'reading'} onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
            </label>
            {error && <p className="skipped" role="alert">{error}</p>}
            <small className="ai-note">The file’s text is sent to Google Gemini to read it. It is not stored.</small>
            <div className="proposal-actions"><button type="button" className="btn" onClick={close}>Cancel</button></div>
          </>
        )}

        {(stage === 'review' || stage === 'creating') && preview && (
          <div className="tailor-body">
            <p><strong>{preview.resume.basics.firstName} {preview.resume.basics.lastName}</strong>{preview.resume.basics.headline ? ` · ${preview.resume.basics.headline}` : ''}<br /><small className="ai-note">{fileName} · {preview.kind.toUpperCase()}{preview.language ? ` · ${preview.language}` : ''}</small></p>
            {preview.warnings.length > 0 && (
              <div className="tailor-spec">
                <h3>Check these</h3>
                <ul className="gaps">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}
            <h3>What I found</h3>
            <ul className="found-list">
              {Object.entries(preview.stats).map(([title, n]) => <li key={title}><span>{title}</span><span className="mem-kind">{n} {n === 1 ? 'item' : 'items'}</span></li>)}
            </ul>
            {diffs.length > 0 && (
              <>
                <h3>Personal details that differ from {persona.firstName}’s</h3>
                <ul className="applied proposal-list">
                  {diffs.map((f) => (
                    <li key={f.key}>
                      <label>
                        <input type="checkbox" checked={use.has(f.key)} disabled={stage === 'creating'} onChange={(e) => setUse((cur) => { const n = new Set(cur); e.target.checked ? n.add(f.key) : n.delete(f.key); return n })} />
                        <span><strong>{f.label}</strong>: {f.get(preview.resume.basics)} <small className="ai-note">(now: {f.get(current) || 'empty'})</small></span>
                      </label>
                    </li>
                  ))}
                </ul>
                <small className="ai-note">Ticked details replace {persona.firstName}’s, for all their CVs. Leave them unticked to keep what is there.</small>
              </>
            )}
            {error && <p className="skipped" role="alert">{error}</p>}
            <div className="proposal-actions">
              <button type="button" className="btn primary" disabled={stage === 'creating'} onClick={() => void create()}>{stage === 'creating' ? 'Creating…' : 'Create this CV'}</button>
              <button type="button" className="btn" disabled={stage === 'creating'} onClick={() => { setPreview(null); setStage('pick') }}>Choose another file</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
