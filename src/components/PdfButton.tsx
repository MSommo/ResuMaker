import { useEffect, useState } from 'react'
import { pdf } from '../api/client'
import { useCaps } from '../api/Caps'
import { fullName } from '../model/format'
import { useResume } from '../state/ResumeContext'
import { Download } from './icons'

/** Downloads the CV as a real PDF (rendered by the server); falls back to the print dialog if the server can't. */
export function PdfButton({ className = 'btn small primary' }: { className?: string }) {
  const { id, resume, flush } = useResume()
  const caps = useCaps()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(''), 7000)
    return () => clearTimeout(t)
  }, [error])

  const download = async () => {
    if (!caps.pdf) return window.print()
    setBusy(true)
    setError('')
    try {
      await flush() // the server renders what is saved, so make sure the latest edits are in
      const blob = await pdf(id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${[fullName(resume.basics), resume.basics.headline].filter(Boolean).join(' ') || 'resume'} cv.pdf`.toLowerCase().replace(/[^a-z0-9.]+/g, '-')
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError(`${e instanceof Error ? e.message : 'PDF failed.'} Use Print from the ⋯ menu instead.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={download} disabled={busy} aria-busy={busy} title="Download PDF">
        <Download /> <span className="tb-label">{busy ? 'Preparing PDF…' : 'Download PDF'}</span>
      </button>
      {error && <span className="tb-notice err" role="alert">{error}</span>}
    </>
  )
}
