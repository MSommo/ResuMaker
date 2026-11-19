import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { listPersonas, getPersona } from './api/client'
import Shell from './app/Shell'
import EditorPage from './pages/Editor'
import Home from './pages/Home'
import PersonaNew from './pages/PersonaNew'
import PersonaPage from './pages/PersonaPage'
import Preview from './pages/Preview'
import { LAST_KEY, ResumeProvider } from './state/ResumeContext'

/** /editor and /preview without an id go to the CV you last opened (or the most recent one). */
function Lead({ to }: { to: 'editor' | 'preview' }) {
  const [target, setTarget] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      let id: string | null = null
      try { id = localStorage.getItem(LAST_KEY) } catch { /* ignore */ }
      if (!id) {
        // No remembered CV: use the most recently edited one of the first persona that has any.
        for (const p of await listPersonas().catch(() => [])) {
          const first = (await getPersona(p.id).catch(() => null))?.resumes[0]
          if (first) {
            id = first.id
            break
          }
        }
      }
      if (live) setTarget(id ? `/${to}/${id}` : '/')
    })()
    return () => {
      live = false
    }
  }, [to])
  return target ? <Navigate to={target} replace /> : <div className="state-box" aria-busy="true"><p>Loading…</p></div>
}

function WithResume({ children }: { children: ReactNode }) {
  const { id } = useParams()
  return <ResumeProvider id={id!} key={id}>{children}</ResumeProvider>
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="personas/new" element={<PersonaNew />} />
        <Route path="p/:personaId" element={<PersonaPage />} />
        <Route path="editor" element={<Lead to="editor" />} />
        <Route path="editor/:id" element={<WithResume><EditorPage /></WithResume>} />
      </Route>
      <Route path="preview" element={<Lead to="preview" />} />
      <Route path="preview/:id" element={<WithResume><Preview /></WithResume>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
