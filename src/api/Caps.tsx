import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getCaps, type Caps } from './client'
import { useAuth } from '../auth/AuthContext'

/**
 * What this user can do here.
 * - `ai`: the server has AI (needs GEMINI_API_KEY) **and** this account is entitled to it. AI features show and work.
 * - `aiLocked`: the server has AI but this account doesn't include it. AI features show, disabled, with an upgrade hint.
 * - neither: the server has no AI. AI features hide themselves (upgrading wouldn't help).
 * - `pdf`: the server can render PDFs (needs Chrome).
 */
export interface UserCaps extends Caps {
  aiLocked: boolean
}

const NONE: UserCaps = { ai: false, aiLocked: false, pdf: false }
const Ctx = createContext<UserCaps>(NONE)

export function CapsProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth()
  const [server, setServer] = useState<Caps>({ ai: false, pdf: false })
  useEffect(() => {
    getCaps().then(setServer)
  }, [])
  const entitled = !!me?.ai
  const value = useMemo<UserCaps>(() => ({ pdf: server.pdf, ai: server.ai && entitled, aiLocked: server.ai && !entitled }), [server, entitled])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useCaps = () => useContext(Ctx)
