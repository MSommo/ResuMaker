import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageThumb } from '../components/CvView'
import { Download, Edit, Layout, Sparkle, Undo, User } from '../components/icons'
import { sampleResume } from '../model/sample'

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <User />, title: 'Your details, entered once', text: 'Name, contact and personal details live on your profile and appear on every CV you make.' },
  { icon: <Edit />, title: 'An editor made for CVs', text: 'Sections for experience, skills, languages and links, rich text, and drag and drop to arrange them.' },
  { icon: <Layout />, title: 'Switch layouts anytime', text: 'Pick a layout now and change your mind later. Your content moves with you and nothing is lost.' },
  { icon: <Undo />, title: 'Every version kept', text: 'Each save is kept. See what changed since an earlier version and bring it back in one click.' },
  { icon: <Download />, title: 'Ready to send', text: 'Export a print-ready PDF that looks exactly like the preview.' },
  { icon: <Sparkle />, title: 'AI help, if your account includes it', text: 'Import an existing CV, polish your wording, or tailor a copy to a job posting. It works only with what is already in your CV, and you approve every change.' },
]

/** What a signed-out visitor sees first: what ResuMaker is, and the way in. Static: it makes no authenticated calls. */
export default function Splash() {
  const [front, back] = useMemo(() => [sampleResume('sidebar'), sampleResume('timeline')], [])
  return (
    <div className="splash">
      <header className="splash-bar">
        <span className="splash-brand"><span className="brand-mark" aria-hidden>R</span> ResuMaker</span>
        <Link to="/login" className="btn small">Sign in</Link>
      </header>

      <main>
        <section className="splash-hero" aria-labelledby="splash-h">
          <div className="splash-copy">
            <h1 id="splash-h">One profile. Every CV you need.</h1>
            <p className="splash-lede">
              ResuMaker keeps your details and experience in one place and turns them into clean, print-ready CVs.
              Make a version for each role without retyping a thing.
            </p>
            <div className="splash-cta">
              <Link to="/login" className="btn primary large">Sign in</Link>
              <small>ResuMaker is invite-only. Ask the person who runs it for an invite link.</small>
            </div>
          </div>
          <div className="splash-art" aria-hidden>
            <div className="splash-page back"><PageThumb resume={back} /></div>
            <div className="splash-page front"><PageThumb resume={front} /></div>
          </div>
        </section>

        <section className="splash-features" aria-labelledby="features-h">
          <h2 id="features-h">Everything a CV needs, nothing it doesn’t</h2>
          <ul>
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className="splash-icon" aria-hidden>{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="splash-private" aria-labelledby="private-h">
          <h2 id="private-h">Private by design</h2>
          <p>Accounts are created by invitation only, and your CVs are visible to you alone. Not even administrators can open them.</p>
          <Link to="/login" className="btn primary">Sign in to ResuMaker</Link>
        </section>
      </main>
    </div>
  )
}
