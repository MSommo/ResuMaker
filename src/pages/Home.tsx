import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageThumb } from '../components/CvView'
import { Chevron } from '../components/icons'
import { layouts } from '../layouts/registry'
import { fullName } from '../model/format'
import { sampleResume } from '../model/sample'
import { useResume } from '../state/ResumeContext'

export default function Home() {
  const { resume, setLayout } = useResume()
  const nav = useNavigate()
  const samples = useMemo(() => layouts.map((l) => ({ l, r: sampleResume(l.id) })), [])
  const name = fullName(resume.basics)

  const choose = (id: string) => {
    setLayout(id)
    nav('/editor')
  }

  return (
    <div className="container home">
      <section className="hero">
        <h1>Build a CV that looks the way you work.</h1>
        <p>Pick a layout, fill in your details once, and rearrange the sections to fit. Everything stays in your browser. Export to PDF when you’re done.</p>
        <div className="hero-actions">
          <Link to="/editor" className="btn primary large">Continue editing{name ? ` — ${name}` : ''} <Chevron /></Link>
        </div>
      </section>

      <section aria-labelledby="layouts-h">
        <div className="section-head">
          <h2 id="layouts-h">Choose a layout</h2>
          <p>Your content carries over when you switch, so you can try them all.</p>
        </div>
        <div className="lgrid">
          {samples.map(({ l, r }) => (
            <article key={l.id} className={`lcard ${resume.layoutId === l.id ? 'current' : ''}`}>
              <button type="button" className="lcard-thumb" onClick={() => choose(l.id)} aria-label={`Use the ${l.name} layout`}>
                <PageThumb resume={r} />
              </button>
              <div className="lcard-body">
                <h3>{l.name} {resume.layoutId === l.id && <span className="badge">Current</span>}</h3>
                <p>{l.description}</p>
                <button type="button" className="btn" onClick={() => choose(l.id)}>{resume.layoutId === l.id ? 'Keep editing' : 'Use this layout'}</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
