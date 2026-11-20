import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { getPersona } from './api/client'
import { useAuth, useMe } from './auth/AuthContext'
import Shell from './app/Shell'
import Accept from './pages/Accept'
import Account from './pages/Account'
import EditorPage from './pages/Editor'
import Login from './pages/Login'
import PersonaPage from './pages/PersonaPage'
import Preview from './pages/Preview'
import Users from './pages/Users'
import { LAST_KEY, ResumeProvider } from './state/ResumeContext'

/** /editor and /preview without an id go to the CV you last opened (or your most recent one). */
function Lead({ to }: { to: 'editor' | 'preview' }) {
  const me = useMe()
  const [target, setTarget] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      let id: string | null = null
      try { id = localStorage.getItem(LAST_KEY) } catch { /* ignore */ }
      if (!id) id = (await getPersona(me.persona.id).catch(() => null))?.resumes[0]?.id ?? null
      if (live) setTarget(id ? `/${to}/${id}` : '/')
    })()
    return () => {
      live = false
    }
  }, [to, me.persona.id])
  return target ? <Navigate to={target} replace /> : <div className="state-box" aria-busy="true"><p>Loading…</p></div>
}

function WithResume({ children }: { children: ReactNode }) {
  const { id } = useParams()
  return <ResumeProvider id={id!} key={id}>{children}</ResumeProvider>
}

/** Your own page is the home page: there is no list of other people. */
function Home() {
  return <Navigate to={`/p/${useMe().persona.id}`} replace />
}

function AdminOnly({ children }: { children: ReactNode }) {
  return useMe().role === 'admin' ? <>{children}</> : <Navigate to="/" replace />
}

/** Nothing but the sign-in and invite pages exists until you are signed in. The server enforces it too: this is only the front door. */
export default function App() {
  const { state } = useAuth()
  if (state.status === 'loading') return <div className="state-box" aria-busy="true"><p>Loading…</p></div>
  if (state.status === 'anon')
    return (
      <Routes>
        <Route path="accept" element={<Accept />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="p/:personaId" element={<PersonaPage />} />
        <Route path="account" element={<Account />} />
        <Route path="users" element={<AdminOnly><Users /></AdminOnly>} />
        <Route path="editor" element={<Lead to="editor" />} />
        <Route path="editor/:id" element={<WithResume><EditorPage /></WithResume>} />
      </Route>
      <Route path="accept" element={<Navigate to="/" replace />} />
      <Route path="preview" element={<Lead to="preview" />} />
      <Route path="preview/:id" element={<WithResume><Preview /></WithResume>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
