import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getCaps, type Caps } from './client'

const Ctx = createContext<Caps>({ ai: false, pdf: false })

/** What the server can do (AI needs GEMINI_API_KEY, PDF needs Chrome). Features hide themselves when unavailable. */
export function CapsProvider({ children }: { children: ReactNode }) {
  const [caps, setCaps] = useState<Caps>({ ai: false, pdf: false })
  useEffect(() => {
    getCaps().then(setCaps)
  }, [])
  return <Ctx.Provider value={caps}>{children}</Ctx.Provider>
}

export const useCaps = () => useContext(Ctx)
