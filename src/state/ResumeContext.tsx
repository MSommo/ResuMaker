import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { blankResume } from '../model/sample'
import type { Basics, Resume, Section } from '../model/types'
import { withLayout } from './ops'
import { load, save } from './storage'

interface Api {
  resume: Resume
  setResume: (f: (r: Resume) => Resume) => void
  replace: (r: Resume) => void
  setBasics: (patch: Partial<Basics>) => void
  patchSection: (id: string, patch: Partial<Section>) => void
  setLayout: (id: string) => void
  reset: () => void
}

const Ctx = createContext<Api | null>(null)

export function ResumeProvider({ children }: { children: ReactNode }) {
  const [resume, set] = useState<Resume>(load)
  useEffect(() => save(resume), [resume])

  const setResume = useCallback((f: (r: Resume) => Resume) => set(f), [])
  const api = useMemo<Api>(
    () => ({
      resume,
      setResume,
      replace: (r) => set(withLayout(r, r.layoutId)),
      setBasics: (patch) => set((r) => ({ ...r, basics: { ...r.basics, ...patch } })),
      patchSection: (id, patch) => set((r) => ({ ...r, sections: r.sections.map((s) => (s.id === id ? ({ ...s, ...patch } as Section) : s)) })),
      setLayout: (id) => set((r) => withLayout(r, id)),
      reset: () => set((r) => blankResume(r.layoutId)),
    }),
    [resume, setResume],
  )
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useResume() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useResume must be used inside <ResumeProvider>')
  return v
}
