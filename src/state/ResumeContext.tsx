import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, getResume, saveResume, updatePersona } from '../api/client'
import { fullName } from '../model/format'
import { blankResume } from '../model/sample'
import { personalOf, type Basics, type Resume, type Section } from '../model/types'
import { withLayout } from './ops'

export type SaveState = 'saved' | 'saving' | 'error' | 'conflict'

interface Api {
  id: string
  /** The person this CV belongs to. Their personal details are shared by all their CVs. */
  personaId: string
  resume: Resume
  setResume: (f: (r: Resume) => Resume) => void
  /** Replace the whole CV with an edit made here (autosaves). */
  replace: (r: Resume) => void
  /** Take a CV state that the server already has (e.g. after the assistant edited it): no save needed. */
  adopt: (r: Resume, version: number) => void
  setBasics: (patch: Partial<Basics>) => void
  patchSection: (id: string, patch: Partial<Section>) => void
  setLayout: (id: string) => void
  reset: () => void
  /** Resolves once everything typed so far is saved. */
  flush: () => Promise<void>
  saveState: SaveState
}

const Ctx = createContext<Api | null>(null)
const SAVE_DELAY = 700

export const LAST_KEY = 'resumaker:lastId'


/** The CV minus the persona's details: what the CV endpoint actually stores. */
const cvPart = (r: Resume) => JSON.stringify({ ...r, basics: { headline: r.basics.headline } })
const personalPart = (r: Resume) => JSON.stringify(personalOf(r.basics))

/**
 * Loads one CV (with its persona's details merged in) and autosaves edits, debounced. Two things are saved separately:
 * the CV (content + headline, version-checked) and the persona's personal details (shared by all of the persona's CVs).
 */
export function ResumeProvider({ id, children }: { id: string; children: ReactNode }) {
  const [resume, setR] = useState<Resume | null>(null)
  const [personaId, setPersonaId] = useState('')
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [attempt, setAttempt] = useState(0)

  const ref = useRef<Resume | null>(null) // always the latest CV, synchronously
  const pid = useRef('')
  const version = useRef(0)
  const dirtyCv = useRef(false)
  const dirtyPersona = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const chain = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let live = true
    setR(null)
    setError('')
    ref.current = null
    dirtyCv.current = dirtyPersona.current = false
    getResume(id)
      .then((d) => {
        if (!live) return
        ref.current = d.resume
        version.current = d.version
        pid.current = d.personaId
        setPersonaId(d.personaId)
        setR(d.resume)
        setSaveState('saved')
        try { localStorage.setItem(LAST_KEY, id) } catch { /* ignore */ }
      })
      .catch((e) => live && setError(e instanceof ApiError && e.status === 404 ? 'This CV doesn’t exist (it may have been deleted).' : e.message))
    return () => {
      live = false
    }
  }, [id, attempt])

  const persist = useCallback(async (keepalive = false) => {
    const cur = ref.current
    if (!cur || (!dirtyCv.current && !dirtyPersona.current)) return
    setSaveState('saving')
    // Track what is still unsaved, so a failure re-marks exactly that (and nothing is lost or saved twice).
    let personaPending = dirtyPersona.current
    let cvPending = dirtyCv.current
    try {
      if (personaPending) {
        if (!cur.basics.firstName.trim()) {
          setSaveState('error') // the server requires a first name; keep the edit until one is typed
          return
        }
        dirtyPersona.current = false
        await updatePersona(pid.current, personalOf(cur.basics))
        personaPending = false
      }
      if (cvPending) {
        dirtyCv.current = false
        const out = await saveResume(id, cur, version.current, keepalive)
        version.current = out.version
        cvPending = false
      }
      setSaveState(dirtyCv.current || dirtyPersona.current ? 'saving' : 'saved')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data?.current) {
        // Someone else (another tab, the MCP server…) saved first: take their version.
        ref.current = e.data.current.resume
        version.current = e.data.current.version
        dirtyCv.current = dirtyPersona.current = false
        setR(e.data.current.resume)
        setSaveState('conflict')
      } else {
        if (personaPending) dirtyPersona.current = true
        if (cvPending) dirtyCv.current = true
        setSaveState('error')
      }
    }
  }, [id])

  const queue = useCallback((keepalive = false) => (chain.current = chain.current.then(() => persist(keepalive))), [persist])

  const schedule = useCallback(() => {
    setSaveState('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void queue(), SAVE_DELAY)
  }, [queue])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    await queue()
  }, [queue])

  // Don't lose the last keystrokes when leaving the page or the editor.
  useEffect(() => {
    const onHide = () => {
      if (dirtyCv.current || dirtyPersona.current) {
        clearTimeout(timer.current)
        void queue(true)
      }
    }
    window.addEventListener('beforeunload', onHide)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      onHide()
    }
  }, [queue])

  const setResume = useCallback((f: (r: Resume) => Resume) => {
    const prev = ref.current
    if (!prev) return
    const next = f(prev)
    if (next === prev) return
    if (cvPart(next) !== cvPart(prev)) dirtyCv.current = true
    if (personalPart(next) !== personalPart(prev)) dirtyPersona.current = true
    ref.current = next
    setR(next)
    schedule()
  }, [schedule])

  const api = useMemo<Api | null>(
    () =>
      resume && {
        id,
        personaId,
        resume,
        setResume,
        replace: (r) => setResume(() => withLayout(r, r.layoutId)),
        adopt: (r, v) => {
          clearTimeout(timer.current)
          dirtyCv.current = dirtyPersona.current = false
          ref.current = r
          version.current = v
          setR(r)
          setSaveState('saved')
        },
        setBasics: (patch) => setResume((r) => ({ ...r, basics: { ...r.basics, ...patch } })),
        patchSection: (sid, patch) => setResume((r) => ({ ...r, sections: r.sections.map((s) => (s.id === sid ? ({ ...s, ...patch } as Section) : s)) })),
        setLayout: (lid) => setResume((r) => withLayout(r, lid)),
        reset: () => setResume((r) => ({ ...blankResume(r.layoutId), basics: r.basics })), // clears the content, never the person
        flush,
        saveState,
      },
    [id, personaId, resume, setResume, flush, saveState],
  )

  if (error)
    return (
      <div className="state-box" role="alert">
        <h2>Couldn’t open this CV</h2>
        <p>{error}</p>
        <p>
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>{' '}
          <a className="btn" href="/">Everyone</a>
        </p>
      </div>
    )
  if (!api) return <div className="state-box" aria-busy="true"><p>Loading your CV…</p></div>
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

/** Like useResume, but returns null outside a CV (shared form fields are also used on the persona pages). */
export const useOptionalResume = () => useContext(Ctx)

export function useResume() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useResume must be used inside <ResumeProvider>')
  return v
}
