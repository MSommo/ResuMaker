import { TextField } from '../components/fields'
import { personalOf } from '../model/types'
import { useResume } from '../state/ResumeContext'
import { PersonalFields } from './PersonalFields'

export function PersonalForm() {
  const { resume, setBasics } = useResume()
  const b = resume.basics
  return (
    <div className="form">
      <fieldset>
        <legend>This CV</legend>
        <TextField label="Headline" hint="Only on this CV, e.g. the role it targets: “Senior Software Engineer”" value={b.headline} onChange={(v) => setBasics({ headline: v })} improve={{ kind: 'headline' }} />
      </fieldset>

      <PersonalFields value={personalOf(b)} onChange={setBasics} />
      <p className="form-note">
        Everything above except the headline belongs to <b>{b.firstName || 'this person'}</b> and is shared by all of their CVs. It appears in the header
        and in any <b>Personal details</b> component you place in the CV.
      </p>
    </div>
  )
}
