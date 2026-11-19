import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { LEVEL_LABEL, uid, type Id } from '../model/types'
import { NATIONALITIES, countries } from '../model/countries'
import { useImprove, type ImproveContext, type ImproveSpec } from '../ai/improve'
import { Bold, Down, Italic, Plus, Trash, Up, Chevron } from './icons'

interface FieldProps {
  label: string
  hint?: string
  className?: string
}

function Wrap({ label, hint, className = '', id, action, below, children }: FieldProps & { id: string; action?: ReactNode; below?: ReactNode; children: ReactNode }) {
  return (
    <div className={`field ${className}`}>
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      {children}
      {below}
      {hint && <small>{hint}</small>}
    </div>
  )
}

export function TextField({ label, hint, className, value, onChange, improve, ...rest }: FieldProps & { value: string; onChange: (v: string) => void; improve?: ImproveSpec } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId()
  const ai = useImprove(improve, value, onChange)
  return (
    <Wrap {...{ label, hint, className, id }} action={ai.trigger} below={ai.panel}>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Wrap>
  )
}

export function SelectField({ label, hint, className, value, onChange, options, placeholder }: FieldProps & { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  const id = useId()
  return (
    <Wrap {...{ label, hint, className, id }}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrap>
  )
}

export const CountryField = (p: Omit<Parameters<typeof SelectField>[0], 'options' | 'placeholder'>) => (
  <SelectField {...p} placeholder="Select a country…" options={countries().map((c) => ({ value: c.code, label: c.name }))} />
)

/** Free text with suggestions, so unusual values still work. */
export function NationalityField({ label, hint, className, value, onChange }: FieldProps & { value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <Wrap {...{ label, hint, className, id }}>
      <input id={id} list={`${id}-list`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Start typing…" autoComplete="off" />
      <datalist id={`${id}-list`}>
        {NATIONALITIES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </Wrap>
  )
}

export function MonthField({ label, className, value, onChange, disabled }: FieldProps & { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId()
  // <input type="month"> only accepts YYYY-MM; legacy free text shows blank until edited.
  const valid = /^\d{4}-\d{2}$/.test(value) ? value : ''
  return (
    <Wrap {...{ label, className, id }}>
      <input id={id} type="month" value={valid} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </Wrap>
  )
}

export function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  )
}

/** Textarea with a small formatting toolbar. Stores `**bold**` / `*italic*` markers. */
export function RichTextField({ label, hint, className, value, onChange, rows = 4, improve }: FieldProps & { value: string; onChange: (v: string) => void; rows?: number; improve?: ImproveSpec }) {
  const id = useId()
  const ref = useRef<HTMLTextAreaElement>(null)
  const ai = useImprove(improve, value, onChange)

  const wrap = (marker: string) => {
    const el = ref.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const sel = value.slice(a, b)
    const already = sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= marker.length * 2
    const next = already
      ? value.slice(0, a) + sel.slice(marker.length, -marker.length) + value.slice(b)
      : value.slice(0, a) + marker + (sel || 'text') + marker + value.slice(b)
    onChange(next)
    const start = a + (already ? 0 : marker.length)
    const end = start + (already ? sel.length - marker.length * 2 : sel ? sel.length : 4)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start, end)
    })
  }
  const onKey = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return
    if (e.key === 'b') (e.preventDefault(), wrap('**'))
    if (e.key === 'i') (e.preventDefault(), wrap('*'))
  }

  return (
    <Wrap {...{ label, hint, className, id }} below={ai.panel}>
      <div className="rich">
        <div className="rich-bar" role="toolbar" aria-label="Formatting">
          <button type="button" onClick={() => wrap('**')} title="Bold (Ctrl/⌘ B)" aria-label="Bold"><Bold /></button>
          <button type="button" onClick={() => wrap('*')} title="Italic (Ctrl/⌘ I)" aria-label="Italic"><Italic /></button>
          <span>Blank line = new paragraph</span>
          {ai.trigger}
        </div>
        <textarea id={id} ref={ref} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} />
      </div>
    </Wrap>
  )
}

export function LevelPicker({ value, onChange, label = 'Level' }: { value: number; onChange: (v: number) => void; label?: string }) {
  return (
    <div className="level-picker" role="radiogroup" aria-label={label}>
      <div className="level-dots">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={LEVEL_LABEL[n]} className={n <= value ? 'on' : ''} onClick={() => onChange(n)} />
        ))}
      </div>
      <span>{LEVEL_LABEL[value] ?? ''}</span>
    </div>
  )
}

/** Reorderable list; each item is a collapsible card. New items open automatically. */
export function ListEditor<T extends { id: Id }>({ items, onChange, create, addLabel, summary, render, inline }: {
  items: T[]
  onChange: (items: T[]) => void
  create: () => T
  addLabel: string
  summary: (item: T) => string
  render: (item: T, update: (patch: Partial<T>) => void) => ReactNode
  /** Items are short (one row): no collapsing. */
  inline?: boolean
}) {
  const [open, setOpen] = useState<Set<Id>>(new Set())
  const toggle = (id: Id) => setOpen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = items.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const add = () => {
    const it = create()
    onChange([...items, it])
    setOpen((s) => new Set(s).add(it.id))
  }
  return (
    <div className="list">
      {items.map((it, i) => {
        const isOpen = inline || open.has(it.id)
        return (
          <div key={it.id} className={`item ${isOpen ? 'open' : ''} ${inline ? 'inline' : ''}`}>
            <div className="item-head">
              {!inline && (
                <button type="button" className="item-title" aria-expanded={isOpen} onClick={() => toggle(it.id)}>
                  <Chevron className={isOpen ? 'rot' : ''} /> {summary(it) || <em>Untitled</em>}
                </button>
              )}
              <span className="item-tools">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><Up /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down"><Down /></button>
                <button type="button" onClick={() => onChange(items.filter((x) => x.id !== it.id))} aria-label="Remove"><Trash /></button>
              </span>
            </div>
            {isOpen && <div className="item-body">{render(it, (patch) => onChange(items.map((x) => (x.id === it.id ? { ...x, ...patch } : x))))}</div>}
          </div>
        )
      })}
      <button type="button" className="add" onClick={add}><Plus /> {addLabel}</button>
    </div>
  )
}

/** One bullet or subheading row, with its own Improve button. */
function BulletRow({ heading, text, context, onChange, onToggle, tools }: {
  heading: boolean
  text: string
  context?: ImproveContext
  onChange: (text: string) => void
  onToggle: () => void
  tools: ReactNode
}) {
  const ai = useImprove({ kind: heading ? 'subheading' : 'bullet', context }, text, onChange)
  return (
    <div className={`brow ${heading ? 'is-heading' : ''}`}>
      <button type="button" className="btype" onClick={onToggle} title={heading ? 'Subheading (click to make a bullet)' : 'Bullet (click to make a subheading)'} aria-label={heading ? 'Subheading' : 'Bullet'}>
        {heading ? 'H' : '•'}
      </button>
      <textarea rows={heading ? 1 : 2} value={text} placeholder={heading ? 'Subheading' : 'What did you do or achieve? Use **bold** for key terms.'} onChange={(e) => onChange(e.target.value)} aria-label={heading ? 'Subheading text' : 'Bullet text'} />
      <span className="item-tools">
        {ai.trigger}
        {tools}
      </span>
      {ai.panel}
    </div>
  )
}

/** Bullets with optional subheadings, stored as strings (`#` prefix = subheading). */
export function BulletsEditor({ value, onChange, improveContext }: { value: string[]; onChange: (v: string[]) => void; improveContext?: ImproveContext }) {
  const rows = value.map((raw) => ({ heading: raw.trimStart().startsWith('#'), text: raw.replace(/^\s*#+\s*/, '') }))
  const set = (i: number, heading: boolean, text: string) => onChange(value.map((v, k) => (k === i ? (heading ? `# ${text}` : text) : v)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= value.length) return
    const next = value.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  // Rows are keyed by index so typing never remounts the textarea.
  return (
    <div className="field">
      <label>Highlights</label>
      <div className="bullets">
        {rows.map((r, i) => (
          <BulletRow
            key={i}
            heading={r.heading}
            text={r.text}
            context={improveContext}
            onChange={(t) => set(i, r.heading, t)}
            onToggle={() => set(i, !r.heading, r.text)}
            tools={
              <>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><Up /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down"><Down /></button>
                <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} aria-label="Remove"><Trash /></button>
              </>
            }
          />
        ))}
        <div className="bullets-add">
          <button type="button" className="add" onClick={() => onChange([...value, ' '])}><Plus /> Bullet</button>
          <button type="button" className="add" onClick={() => onChange([...value, '# '])}><Plus /> Subheading</button>
        </div>
      </div>
    </div>
  )
}

export const newId = uid
