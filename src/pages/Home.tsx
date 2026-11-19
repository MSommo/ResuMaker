import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createPersona, createResume, listPersonas, type Persona } from '../api/client'
import { Avatar } from '../components/Avatar'
import { Plus } from '../components/icons'
import { fullName } from '../model/format'
import { personalOf } from '../model/types'
import { readLocalResume } from '../state/storage'

const IMPORTED_KEY = 'resumaker:importedLocal'

/** "Who's building a CV?": pick a persona, or add one. No login: this is a trusted, local app for a household. */
export default function Home() {
  const nav = useNavigate()
  const [people, setPeople] = useState<Persona[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    try {
      let list = await listPersonas()
      // One-time move of a CV saved in this browser by the earliest, server-less version of the app.
      // The flag is claimed *before* any await: React StrictMode runs this effect twice, and both runs would otherwise import.
      if (!list.length && !localStorage.getItem(IMPORTED_KEY)) {
        const local = readLocalResume()
        if (local) {
          localStorage.setItem(IMPORTED_KEY, '1')
          try {
            const details = personalOf(local.basics)
            const persona = await createPersona({ ...details, firstName: details.firstName.trim() || 'Me' })
            await createResume(persona.id, { resume: local })
          } catch (e) {
            localStorage.removeItem(IMPORTED_KEY) // allow a retry
            throw e
          }
          setNotice('We found a CV saved in this browser and moved it to the server, under its own persona.')
          list = await listPersonas()
        }
      }
      setPeople(list)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
  }
  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="container home">
      <section className="hero">
        <h1>Who’s building a CV?</h1>
        <p>Pick a person to see their CVs, or add someone new. Each person keeps their own details and any number of CVs.</p>
      </section>

      {error && (
        <div className="state-box inline" role="alert">
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => void load()}>Try again</button>
        </div>
      )}
      {notice && <p className="notice" role="status">{notice}</p>}

      {people && (
        <ul className="pgrid" aria-label="Personas">
          {people.map((p) => (
            <li key={p.id}>
              <Link to={`/p/${p.id}`} className="pcard">
                <Avatar id={p.id} first={p.firstName} last={p.lastName} size={64} />
                <span className="pcard-name">{fullName(p)}</span>
                <span className="pcard-meta">{p.resumeCount === 0 ? 'No CVs yet' : `${p.resumeCount} CV${p.resumeCount > 1 ? 's' : ''}`}</span>
              </Link>
            </li>
          ))}
          <li>
            <button type="button" className="pcard new" onClick={() => nav('/personas/new')}>
              <span className="avatar plus" aria-hidden><Plus /></span>
              <span className="pcard-name">New persona</span>
              <span className="pcard-meta">Add a person</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}
