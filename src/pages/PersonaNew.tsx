import { Link, useNavigate } from 'react-router-dom'
import { createPersona } from '../api/client'
import { Back } from '../components/icons'
import { PersonaForm, emptyPersonal } from '../components/PersonaForm'
import { rememberPersona } from '../state/ResumeContext'
import { fullName } from '../model/format'

export default function PersonaNew() {
  const nav = useNavigate()
  return (
    <div className="container narrow page">
      <Link to="/" className="back"><Back /> Everyone</Link>
      <h1>New persona</h1>
      <p className="lede">Personal details are stored once and used on every CV this person creates. You can change them any time.</p>
      <PersonaForm
        initial={emptyPersonal()}
        submitLabel="Create persona"
        onSubmit={async (d) => {
          const p = await createPersona(d)
          rememberPersona(p.id, fullName(p))
          nav(`/p/${p.id}`)
        }}
        onCancel={() => nav('/')}
      />
    </div>
  )
}
