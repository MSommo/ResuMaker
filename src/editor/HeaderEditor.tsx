import { TextField } from '../components/fields'
import { Back } from '../components/icons'
import { fullName } from '../model/format'
import { useResume } from '../state/ResumeContext'

/** The CV's header: its headline (only this CV) under your name (from your profile, shared by all your CVs). */
export function HeaderEditor({ onBack, goInfo }: { onBack: () => void; goInfo: () => void }) {
  const { resume, setBasics } = useResume()
  const b = resume.basics
  return (
    <div className="section-editor">
      <button type="button" className="back" onClick={onBack}><Back /> All sections</button>
      <div className="form">
        <TextField label="Headline" hint="Shown under your name: the role this CV targets, e.g. “Senior Software Engineer”. Only on this CV." value={b.headline} onChange={(v) => setBasics({ headline: v })} improve={{ kind: 'headline' }} />
        <p className="form-note">
          Your name, <b>{fullName(b) || 'not set yet'}</b>, comes from your profile and is the same on all your CVs. Change it in <button type="button" className="link" onClick={goInfo}>Personal info</button>.
        </p>
      </div>
    </div>
  )
}
