import { useEffect, useState } from 'react'
import { addMemory, deleteMemory, listMemories, type Memory } from '../api/client'
import { Close, Trash } from '../components/icons'

/**
 * What the assistant remembers about this person. Everything in memory is listed here and can be deleted. Items are only added when
 * you ask the assistant to remember something ("remember that I prefer short bullets") or add one below. Memory is context for the
 * assistant, never a source of truth: your CV's own text always wins.
 */
export function MemoryDialog({ personaId, onClose }: { personaId: string; onClose: () => void }) {
  const [items, setItems] = useState<Memory[] | null>(null)
  const [kind, setKind] = useState<Memory['kind']>('preference')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listMemories(personaId).then(setItems).catch((e) => setError(e instanceof Error ? e.message : 'Could not load memory.'))
  }, [personaId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const add = async () => {
    setBusy(true)
    setError('')
    try {
      const m = await addMemory(personaId, kind, text)
      setItems((cur) => [m, ...(cur ?? []).filter((x) => x.id !== m.id)])
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string) => {
    setItems((cur) => (cur ?? []).filter((m) => m.id !== id))
    await deleteMemory(id).catch(() => listMemories(personaId).then(setItems).catch(() => {}))
  }

  return (
    <div className="modal-backdrop no-print" role="presentation">
      <section className="modal tailor memory" role="dialog" aria-label="Memory">
        <header>
          <h2>Memory</h2>
          <span className="tb-grow" />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Close /></button>
        </header>
        <p className="tailor-help">What the assistant remembers about this person, so you don’t repeat yourself. Say <em>“remember that I prefer short bullets”</em> in the chat, or add something here. It is only used as context: your CV’s own text always wins. Delete anything you like.</p>

        <form className="memory-add" onSubmit={(e) => (e.preventDefault(), void add())}>
          <select value={kind} onChange={(e) => setKind(e.target.value as Memory['kind'])} aria-label="Kind">
            <option value="preference">Preference</option>
            <option value="fact">Fact</option>
          </select>
          <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder={kind === 'preference' ? 'e.g. Prefers bullets under 12 words' : 'e.g. Was Staff Engineer at Acme from 2021'} aria-label="Memory text" />
          <button type="submit" className="btn primary small" disabled={busy || !text.trim()}>Add</button>
        </form>
        {error && <p className="skipped">{error}</p>}

        {items === null ? <p className="ai-note">Loading…</p> : items.length === 0 ? <p className="ai-note">Nothing remembered yet.</p> : (
          <ul className="memory-list">
            {items.map((m) => (
              <li key={m.id}>
                <span className={`mem-kind ${m.kind}`}>{m.kind === 'preference' ? 'Preference' : 'Fact'}</span>
                <span className="mem-text">{m.text}</span>
                <button type="button" className="icon-btn" onClick={() => void remove(m.id)} aria-label={`Forget: ${m.text}`} title="Forget this"><Trash /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
