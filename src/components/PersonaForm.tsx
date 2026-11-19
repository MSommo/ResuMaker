import { useState } from 'react'
import { PersonalFields } from '../editor/PersonalFields'
import type { PersonalDetails } from '../model/types'

export const emptyPersonal = (): PersonalDetails => ({
  firstName: '', lastName: '', email: '', phone: '',
  address: { street: '', city: '', postcode: '', country: '' }, birthDate: '', birthPlace: '', nationality: '',
})

/** Create or edit a persona's details. */
export function PersonaForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial: PersonalDetails
  submitLabel: string
  onSubmit: (d: PersonalDetails) => Promise<void>
  onCancel?: () => void
}) {
  const [d, setD] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <form
      className="form persona-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        try {
          await onSubmit(d)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Something went wrong.')
          setBusy(false)
        }
      }}
    >
      <PersonalFields value={d} onChange={(patch) => setD((x) => ({ ...x, ...patch }))} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={busy || !d.firstName.trim()}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  )
}
