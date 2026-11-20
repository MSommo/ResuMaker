import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, createResume, importCv, updatePersona, type ImportPreview, type Persona } from '../api/client'
import { Check, Sparkle, Upload } from '../components/icons'
import { personalOf, type PersonalDetails } from '../model/types'

const MAX_MB = 10
const EXT = /\.(pdf|docx|html?)$/i
const READING_STEPS = ['Opening the file', 'Reading the text', 'Sorting it into sections', 'Tidying names, dates and bullets']

/** Why this file can't be imported, or '' if it can. Checked before upload so the answer is instant. */
export function fileProblem(f: File): string {
  if (/\.doc$/i.test(f.name)) return 'Old .doc files aren’t supported: save it as DOCX or PDF first.'
  if (!EXT.test(f.name)) return 'Use a PDF, DOCX or HTML file.'
  if (f.size > MAX_MB * 1024 * 1024) return `That file is larger than ${MAX_MB} MB.`
  if (f.size === 0) return 'That file is empty.'
  return ''
}
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
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
 * Import a CV from a PDF, DOCX or HTML file, in place on the page (no modal). The file is read by the assistant into our format and shown for review (warnings,
 * what was found, and any personal details that differ from this person's). Nothing is created until you confirm.
 */
export function ImportPanel({ persona, incoming }: { persona: Persona; incoming?: { file: File; n: number } }) {
  const nav = useNavigate()
  const [stage, setStage] = useState<Stage>('pick')
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [step, setStep] = useState(0)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [use, setUse] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const current = useMemo(() => personalOf({ ...persona, headline: '' }), [persona])

  const root = useRef<HTMLElement>(null)
  const reset = () => {
    abort.current?.abort()
    setPreview(null)
    setError('')
    setStage('pick')
  }
  useEffect(() => () => abort.current?.abort(), [])

  // A file dropped anywhere on the page arrives here.
  useEffect(() => {
    if (!incoming) return
    root.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    void read(incoming.file)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.n])

  const diffs = useMemo(() => (preview ? FIELDS.filter((f) => f.get(preview.resume.basics).trim() && f.get(preview.resume.basics) !== f.get(current)) : []), [preview, current])

  // Progress is indicative: the server answers once, so the messages just keep pace with a typical read.
  useEffect(() => {
    if (stage !== 'reading') return
    setStep(0)
    const t = setInterval(() => setStep((n) => Math.min(n + 1, READING_STEPS.length - 1)), 3500)
    return () => clearInterval(t)
  }, [stage])

  const read = async (file: File) => {
    const problem = fileProblem(file)
    if (problem) return setError(problem)
    setError('')
    setFileName(file.name)
    setFileSize(file.size)
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
      nav(`/editor/${doc.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the CV.')
      setStage('review')
    }
  }

  return (
    <section className="imp-panel no-print" aria-label="Import a CV" ref={root}>

        {(stage === 'pick' || stage === 'reading') && (
          <div
            className="imp-pick"
            onDragOver={(e) => { e.preventDefault(); if (stage === 'pick') setDrag(true) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false) }}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              const f = e.dataTransfer.files?.[0]
              if (f && stage === 'pick') void read(f)
            }}
          >
            <label className={`dropzone ${drag ? 'over' : ''} ${stage === 'reading' ? 'busy' : ''} ${error ? 'bad' : ''}`}>
              {stage === 'reading' ? (
                <div className="dz-reading" role="status" aria-live="polite">
                  <span className="dz-icon"><Sparkle className="spin" /></span>
                  <strong>{fileName}</strong>
                  <small>{size(fileSize)}</small>
                  <ol className="dz-steps">
                    {READING_STEPS.map((t, i) => <li key={t} className={i < step ? 'done' : i === step ? 'now' : ''}>{i < step ? <Check /> : <i />}{t}</li>)}
                  </ol>
                </div>
              ) : (
                <div className="dz-idle">
                  <span className="dz-icon"><Upload /></span>
                  {/* Touch screens can't drag files: there the box is simply a file picker. */}
                  <strong className="dz-say-drag">{drag ? 'Drop it to import' : 'Drag a CV here'}</strong>
                  <span className="dz-say-or">or <u>choose a file</u></span>
                  <strong className="dz-say-tap">Choose a CV file to import</strong>
                  <span className="dz-types"><b>PDF</b><b>DOCX</b><b>HTML</b><em>up to {MAX_MB} MB</em></span>
                </div>
              )}
              <input type="file" accept=".pdf,.docx,.html,.htm,application/pdf" disabled={stage === 'reading'} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f) }} />
            </label>
            {error && <p className="imp-error" role="alert">{error}</p>}
            <small className="ai-note">I’ll turn it into an editable CV and show you what I found before anything is created. The file’s text is sent to an AI service to read it; it is not stored.</small>
            {stage === 'reading' && <div className="proposal-actions"><button type="button" className="btn" onClick={reset}>Cancel</button></div>}
          </div>
        )}

        {(stage === 'review' || stage === 'creating') && preview && (
          <div className="tailor-body imp-review">
            <div className="imp-who">
              <span className="imp-badge" aria-hidden><Check /></span>
              <div>
                <strong>{preview.resume.basics.firstName} {preview.resume.basics.lastName}</strong>
                {preview.resume.basics.headline && <div>{preview.resume.basics.headline}</div>}
                <small className="ai-note">{fileName} · {preview.kind.toUpperCase()}{preview.language ? ` · ${preview.language}` : ''}</small>
              </div>
            </div>
            {preview.warnings.length > 0 && (
              <div className="imp-warn" role="note">
                <strong>Worth a look</strong>
                <ul>{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}
            <h3>What I found</h3>
            <ul className="imp-chips">
              {Object.entries(preview.stats).map(([title, n]) => <li key={title}><b>{n}</b> {title}</li>)}
            </ul>
            {diffs.length > 0 && (
              <>
                <h3>Details that differ from {persona.firstName}’s</h3>
                <ul className="imp-diffs">
                  {diffs.map((f) => (
                    <li key={f.key}>
                      <label>
                        <input type="checkbox" checked={use.has(f.key)} disabled={stage === 'creating'} onChange={(e) => setUse((cur) => { const n = new Set(cur); e.target.checked ? n.add(f.key) : n.delete(f.key); return n })} />
                        <span className="imp-field">{f.label}</span>
                        <span className="imp-old">{f.get(current) || 'empty'}</span>
                        <span aria-hidden>→</span>
                        <span className="imp-new">{f.get(preview.resume.basics)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <small className="ai-note">Ticked details replace {persona.firstName}’s, on all their CVs. Leave them unticked to keep what is there.</small>
              </>
            )}
            {error && <p className="imp-error" role="alert">{error}</p>}
            <div className="proposal-actions">
              <button type="button" className="btn primary" disabled={stage === 'creating'} onClick={() => void create()}>{stage === 'creating' ? 'Creating…' : 'Create this CV'}</button>
              <button type="button" className="btn" disabled={stage === 'creating'} onClick={reset}>Start over</button>
            </div>
          </div>
        )}
    </section>
  )
}
