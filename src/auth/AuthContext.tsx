import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getMe, signOut, UNAUTHORIZED, type Me } from '../api/client'
import { LAST_KEY } from '../state/ResumeContext'

type State = { status: 'loading' } | { status: 'anon' } | { status: 'in'; me: Me }

interface Auth {
  state: State
  me: Me | null
  /** Called after a successful sign-in / accepted invite. */
  setMe: (me: Me) => void
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

/** What this browser remembers is per person: never carry one user's last CV or name over to the next on a shared computer. */
function forgetLocal() {
  try {
    localStorage.removeItem(LAST_KEY)
    localStorage.removeItem('resumaker:lastPersona') // older versions stored a name here
  } catch { /* ignore */ }
}

/** Who is signed in. The browser holds an HttpOnly cookie; this only asks the server "who am I?" and reacts when the answer becomes "nobody". */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  const refresh = useCallback(async () => {
    try {
      setState({ status: 'in', me: await getMe() })
    } catch {
      setState({ status: 'anon' })
    }
  }, [])
  useEffect(() => {
    void refresh()
    const onOut = () => {
      forgetLocal()
      setState({ status: 'anon' })
    }
    window.addEventListener(UNAUTHORIZED, onOut)
    return () => window.removeEventListener(UNAUTHORIZED, onOut)
  }, [refresh])

  const value = useMemo<Auth>(
    () => ({
      state,
      me: state.status === 'in' ? state.me : null,
      setMe: (me) => setState({ status: 'in', me }),
      refresh,
      logout: async () => {
        try { await signOut() } finally {
          forgetLocal()
          setState({ status: 'anon' })
        }
      },
    }),
    [state, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): Auth {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

/** The signed-in user. Only call inside the signed-in part of the app. */
export function useMe(): Me {
  const { me } = useAuth()
  if (!me) throw new Error('useMe while signed out')
  return me
}
