import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './app/Shell'
import EditorPage from './pages/Editor'
import Home from './pages/Home'
import Preview from './pages/Preview'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="editor" element={<EditorPage />} />
      </Route>
      <Route path="preview" element={<Preview />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
