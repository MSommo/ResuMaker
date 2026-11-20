import { Hint } from '../components/Hint'
import { personalOf } from '../model/types'
import { useResume } from '../state/ResumeContext'
import { PersonalFields } from './PersonalFields'

/** Your profile: the details every one of your CVs shares. (The headline, which is per CV, is in the Header card on Sections.) */
export function PersonalForm() {
  const { resume, setBasics } = useResume()
  return (
    <div className="form pi">
      <p className="pi-sub">
        Shared by all your CVs
        <Hint label="About these details">
          Fill these in once: a change here updates every CV you have. They appear in the header and in the Personal details block, wherever you place it. The headline is the only part that belongs to a single CV: edit it in Header.
        </Hint>
      </p>
      <PersonalFields value={personalOf(resume.basics)} onChange={setBasics} />
    </div>
  )
}
