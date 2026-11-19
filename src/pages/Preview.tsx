import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CvViewport } from '../components/CvView'
import { PdfButton } from '../components/PdfButton'
import { Back, Expand, Print } from '../components/icons'
import type { ZoomMode } from '../components/useFit'
import { getLayout } from '../layouts/registry'
import { fullName } from '../model/format'
import { useResume } from '../state/ResumeContext'

const ZOOMS: { value: string; label: string; mode: ZoomMode }[] = [
  { value: 'width', label: 'Fit width', mode: 'width' },
  { value: 'page', label: 'Fit page', mode: 'page' },
  { value: '0.75', label: '75%', mode: 0.75 },
  { value: '1', label: '100%', mode: 1 },
  { value: '1.25', label: '125%', mode: 1.25 },
  { value: '1.5', label: '150%', mode: 1.5 },
]

/** Standalone fullscreen preview: no navbar or footer, just the CV. */
export default function Preview() {
  const { id, resume } = useResume()
  const nav = useNavigate()
  const [zoom, setZoom] = useState('width')
  const [fs, setFs] = useState(!!document.fullscreenElement)

  const toggleFs = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) nav(`/editor/${id}`)
      if (e.key.toLowerCase() === 'f' && !(e.target instanceof HTMLSelectElement)) toggleFs()
    }
    const onFs = () => setFs(!!document.fullscreenElement)
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
    }
  }, [nav, id])

  return (
    <div className="preview-page">
      <header className="pv-bar no-print">
        <Link to={`/editor/${id}`} className="btn small"><Back /> Back to editor</Link>
        <span className="pv-title">{fullName(resume.basics) || 'Untitled CV'} · {getLayout(resume.layoutId).name}</span>
        <span className="tb-grow" />
        <select value={zoom} onChange={(e) => setZoom(e.target.value)} aria-label="Zoom">
          {ZOOMS.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
        </select>
        <button type="button" className="btn small" onClick={toggleFs} aria-pressed={fs}><Expand /> {fs ? 'Exit fullscreen' : 'Fullscreen'}</button>
        <PdfButton />
        <button type="button" className="btn small" onClick={() => window.print()}><Print /> Print</button>
      </header>
      <CvViewport resume={resume} mode={ZOOMS.find((z) => z.value === zoom)!.mode} max={2} className="pv-viewport" />
    </div>
  )
}
