import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { LEVEL_LABEL, uid, type Id } from '../model/types'
import { NATIONALITIES, countries } from '../model/countries'
import { useImprove, type ImproveContext, type ImproveSpec } from '../ai/improve'
import { SECTION_ICONS } from '../layouts/icons'
import { ICON_LABEL, type IconId } from '../model/types'
import { Chevron, Down, Plus, Trash, Up } from './icons'
import { Menu, MenuItem, MenuSep } from './Popover'
import { EditorSurface, LinkBar, RichToolbar, useMarkdownEditor } from './RichEditor'

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

export function TextField({ label, hint, className, value, onChange, improve, error, ...rest }: FieldProps & { value: string; onChange: (v: string) => void; improve?: ImproveSpec; error?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId()
  const ai = useImprove(improve, value, onChange)
  return (
    <Wrap {...{ label, hint, className, id }} action={ai.trigger} below={<>{ai.panel}{error && <small className="field-error" id={`${id}-err`} role="alert">{error}</small>}</>}>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-err` : undefined} {...rest} />
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

export function MonthField({ label, className, value, onChange, disabled, error }: FieldProps & { value: string; onChange: (v: string) => void; disabled?: boolean; error?: string }) {
  const id = useId()
  // <input type="month"> only accepts YYYY-MM; legacy free text shows blank until edited.
  const valid = /^\d{4}-\d{2}$/.test(value) ? value : ''
  return (
    <Wrap {...{ label, className, id }} below={error && <small className="field-error" id={`${id}-err`} role="alert">{error}</small>}>
      <input id={id} type="month" value={valid} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-err` : undefined} />
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

function MarkdownHelp() {
  const mod = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform) ? '⌘' : 'Ctrl+'
  return (
    <details className="md-help">
      <summary>Typing shortcuts</summary>
      <div>
        <p>Text formats as you type, and what you see is what the CV shows. A blank line starts a new paragraph.</p>
        <dl>
          <dt><code>**bold**</code> <code>*italic*</code> <code>~~strike~~</code> <code>`code`</code></dt>
          <dd>Inline styles ({mod}B, {mod}I)</dd>
          <dt><code>## </code> <code>### </code> at the start of a line</dt>
          <dd>Headings</dd>
          <dt><code>- </code> <code>1. </code> <code>[ ] </code> at the start of a line</dt>
          <dd>Lists; Enter continues a list, Enter on an empty item ends it</dd>
          <dt><code>&gt; </code> <code>---</code></dt>
          <dd>Quote, horizontal rule</dd>
          <dt><code>[text](https://…)</code></dt>
          <dd>Link ({mod}K). Images and raw HTML are not shown.</dd>
        </dl>
      </div>
    </details>
  )
}

/** Rich text box: always shows the formatted text, formats as you type Markdown, and stores plain Markdown. */
export function RichTextField({ label, hint, className, value, onChange, rows = 4, improve, placeholder }: FieldProps & { value: string; onChange: (v: string) => void; rows?: number; improve?: ImproveSpec; placeholder?: string }) {
  const id = useId()
  const ai = useImprove(improve, value, onChange)
  const { editor, linkOpen, setLinkOpen } = useMarkdownEditor({ value, onChange, placeholder, label, id })
  return (
    <Wrap {...{ label, hint, className, id }} below={ai.panel}>
      <div className="rich">
        <RichToolbar editor={editor} onLink={() => setLinkOpen((o) => !o)} linkOn={linkOpen}>
          {ai.trigger}
        </RichToolbar>
        {linkOpen && editor && <LinkBar editor={editor} onClose={() => setLinkOpen(false)} />}
        <EditorSurface editor={editor} minRows={rows} />
      </div>
      <MarkdownHelp />
    </Wrap>
  )
}

/** Picks a section icon by showing the icons themselves (names are tooltips). */
export function IconPicker({ label, hint, className, value, onChange }: FieldProps & { value: IconId; onChange: (v: IconId) => void }) {
  const id = useId()
  return (
    <div className={`field ${className ?? ''}`}>
      <div className="field-head"><span className="label" id={id}>{label}</span></div>
      <div className="icon-picker" role="radiogroup" aria-labelledby={id}>
        {(Object.keys(ICON_LABEL) as IconId[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} aria-label={ICON_LABEL[k]} title={ICON_LABEL[k]} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
            {SECTION_ICONS[k]}
          </button>
        ))}
      </div>
      {hint && <small>{hint}</small>}
    </div>
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
export function ListEditor<T extends { id: Id }>({ items, onChange, create, addLabel, itemName = 'item', summary, detail, render, inline }: {
  items: T[]
  onChange: (items: T[]) => void
  create: () => T
  addLabel: string
  /** What one item is called, for button names: "entry", "link"… */
  itemName?: string
  summary: (item: T) => string
  /** Second, quieter line under the summary (e.g. dates). */
  detail?: (item: T) => string
  render: (item: T, update: (patch: Partial<T>) => void) => ReactNode
  /** Items are short (one row): no collapsing. */
  inline?: boolean
}) {
  const [open, setOpen] = useState<Set<Id>>(new Set())
  const toggle = (id: Id) => setOpen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)))
  const root = useRef<HTMLDivElement>(null)
  // Focus follows the action: after a change the DOM node a keyboard user was on may be gone or moved, which drops focus to the page.
  // Candidates are tried in order; the first one that exists and is enabled gets it.
  const [focusAfter, setFocusAfter] = useState<string[] | null>(null)
  useEffect(() => {
    if (!focusAfter) return
    for (const sel of focusAfter) {
      const el = root.current?.querySelector<HTMLElement>(sel)
      if (el && !(el as HTMLButtonElement).disabled) {
        el.focus()
        break
      }
    }
    setFocusAfter(null)
  }, [focusAfter])
  const act = (id: Id, name: string) => `[data-item="${id}"] [data-act="${name}"]`
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = items.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
    // Keep the cursor on the same button; at either end that button is disabled, so land on its partner.
    setFocusAfter([act(items[i].id, d < 0 ? 'up' : 'down'), act(items[i].id, d < 0 ? 'down' : 'up')])
  }
  const add = () => {
    const it = create()
    onChange([...items, it])
    setOpen((s) => new Set(s).add(it.id))
    // The new item's first field.
    setFocusAfter([`[data-item="${it.id}"] .item-body input`, `[data-item="${it.id}"] .item-body [contenteditable]`])
  }
  const remove = (it: T, i: number) => {
    const name = summary(it).trim()
    // Only ask when there is something to lose; a blank item just added by mistake goes quietly.
    if (name && !window.confirm(`Remove “${name}”?`)) return
    onChange(items.filter((x) => x.id !== it.id))
    // The item that took its place (or the one before it); with none left, the Add button.
    const near = items[i + 1] ?? items[i - 1]
    setFocusAfter([...(near ? [act(near.id, 'remove')] : []), ':scope > [data-act="add"]'])
  }
  return (
    <div className="list" ref={root}>
      {items.map((it, i) => {
        const isOpen = inline || open.has(it.id)
        return (
          <div key={it.id} data-item={it.id} className={`item ${isOpen ? 'open' : ''} ${inline ? 'inline' : ''}`}>
            <div className="item-head">
              {!inline && (
                <button type="button" className="item-title" aria-expanded={isOpen} onClick={() => toggle(it.id)}>
                  <Chevron className={isOpen ? 'rot' : ''} />
                  <span className="item-title-text">
                    <strong>{summary(it) || <em>Untitled</em>}</strong>
                    {detail?.(it) && <small>{detail(it)}</small>}
                  </span>
                </button>
              )}
              <span className="item-tools">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${summary(it) || itemName} up`} title="Move up" data-act="up"><Up /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Move ${summary(it) || itemName} down`} title="Move down" data-act="down"><Down /></button>
                <button type="button" onClick={() => remove(it, i)} aria-label={`Remove ${summary(it) || itemName}`} title="Remove" data-act="remove"><Trash /></button>
              </span>
            </div>
            {isOpen && <div className="item-body">{render(it, (patch) => onChange(items.map((x) => (x.id === it.id ? { ...x, ...patch } : x))))}</div>}
          </div>
        )
      })}
      <button type="button" className="add" data-act="add" onClick={add}><Plus /> {addLabel}</button>
    </div>
  )
}

/** One bullet or subheading row: marker, text, and a short action column (Improve + a menu), so the text gets the full width. */
function BulletRow({ heading, text, context, onChange, onToggle, onMove, onRemove, first, last }: {
  heading: boolean
  text: string
  context?: ImproveContext
  onChange: (text: string) => void
  onToggle: () => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  first: boolean
  last: boolean
}) {
  const ai = useImprove({ kind: heading ? 'subheading' : 'bullet', context }, text, onChange)
  const label = heading ? 'Subheading text' : 'Bullet text'
  const { editor, linkOpen, setLinkOpen } = useMarkdownEditor({
    value: text,
    onChange,
    inline: true,
    label,
    placeholder: heading ? 'Subheading' : 'What did you do or achieve?',
  })
  return (
    <div className={`brow ${heading ? 'is-heading' : ''}`}>
      <span className="bmark" aria-hidden title={heading ? 'Subheading' : 'Bullet'} />
      <EditorSurface editor={editor} />
      <span className="brow-actions">
        {ai.trigger}
        <Menu label={heading ? 'Subheading options' : 'Bullet options'} triggerClassName="icon-btn small-btn">
          <MenuItem onSelect={onToggle}>{heading ? 'Make it a bullet' : 'Make it a subheading'}</MenuItem>
          <MenuItem icon={<Up />} onSelect={() => onMove(-1)} disabled={first}>Move up</MenuItem>
          <MenuItem icon={<Down />} onSelect={() => onMove(1)} disabled={last}>Move down</MenuItem>
          <MenuSep />
          <MenuItem icon={<Trash />} danger onSelect={onRemove}>Remove</MenuItem>
        </Menu>
      </span>
      {linkOpen && editor && <div className="brow-link"><LinkBar editor={editor} onClose={() => setLinkOpen(false)} /></div>}
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
  // Rows are keyed by index so typing never remounts the editor.
  const id = useId()
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span className="label" id={id}>Bullets</span>
      <div className="bullets">
        {rows.map((r, i) => (
          <BulletRow
            key={i}
            heading={r.heading}
            text={r.text}
            context={improveContext}
            onChange={(t) => set(i, r.heading, t)}
            onToggle={() => set(i, !r.heading, r.text)}
            onMove={(d) => move(i, d)}
            onRemove={() => onChange(value.filter((_, k) => k !== i))}
            first={i === 0}
            last={i === rows.length - 1}
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
