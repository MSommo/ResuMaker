import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { blockExtensions, inlineExtensions } from './markdown/extensions'
import { Bold, Check, Close, Code, Heading, Italic, LinkIcon, ListOl, ListUl, Quote, Rule, Strike, Task, Trash } from './icons'

const MOD = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform) ? '⌘' : 'Ctrl+'

const getMarkdown = (ed: Editor): string => (ed.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()

/** "example.com" → "https://example.com"; leaves mailto:, tel:, http(s): and #anchors alone. */
export function normalizeUrl(raw: string): string {
  const u = raw.trim()
  if (!u) return ''
  if (/^(https?:|mailto:|tel:|#)/i.test(u)) return u
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return `mailto:${u}`
  return /^[\w-]+(\.[\w-]+)+/.test(u) ? `https://${u}` : ''
}

/**
 * A Markdown text box that formats as you type (`**bold**`, `- `, `## `, …) and always shows the formatted result.
 * The value stays a Markdown string, so the CV, the AI and the PDF read it exactly as before.
 */
export function useMarkdownEditor({ value, onChange, inline = false, placeholder = '', label, id }: {
  value: string
  onChange: (v: string) => void
  inline?: boolean
  placeholder?: string
  label: string
  id?: string
}) {
  const last = useRef(value) // the Markdown the editor last agreed on with its owner
  const change = useRef(onChange)
  change.current = onChange
  const [linkOpen, setLinkOpen] = useState(false)
  const extensions = useMemo(() => (inline ? inlineExtensions(placeholder) : blockExtensions(placeholder)), [inline, placeholder])

  const editor = useEditor({
    extensions,
    content: value,
    editorProps: {
      attributes: { ...(id ? { id } : {}), role: 'textbox', 'aria-label': label, 'aria-multiline': String(!inline), spellcheck: 'true', class: `md rte ${inline ? 'rte-inline' : ''}` },
      handleKeyDown: (_view, e) => {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
          e.preventDefault()
          setLinkOpen(true)
          return true
        }
        return inline && e.key === 'Enter' // a bullet is one line
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = getMarkdown(ed)
      if (md !== last.current) {
        last.current = md
        change.current(md)
      }
    },
  })

  // Changes that come from outside (AI "Use this", undo, a bullet being moved) replace the content; typing never goes through here.
  useEffect(() => {
    if (!editor || value === last.current) return
    last.current = value
    editor.commands.setContent(value, { emitUpdate: false })
  }, [value, editor])

  return { editor, linkOpen, setLinkOpen }
}

export function EditorSurface({ editor, minRows }: { editor: Editor | null; minRows?: number }) {
  return <EditorContent editor={editor} className="rte-wrap" style={minRows ? ({ '--rows': minRows } as React.CSSProperties) : undefined} />
}

/** Small inline form to set, change or remove the link under the cursor / on the selection. */
export function LinkBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = (editor.getAttributes('link').href as string | undefined) ?? ''
  const [url, setUrl] = useState(current)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const apply = () => {
    const href = normalizeUrl(url)
    if (!href) return
    const { empty } = editor.state.selection
    if (empty && !editor.isActive('link')) {
      // Nothing selected: insert the address itself as the link text.
      editor.chain().focus().command(({ tr, state }) => {
        const mark = state.schema.marks.link.create({ href })
        tr.insert(tr.selection.from, state.schema.text(url.trim(), [mark]))
        return true
      }).run()
    } else editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    onClose()
  }
  return (
    <form className="link-bar" onSubmit={(e) => (e.preventDefault(), apply())} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose(), editor.commands.focus())}>
      <LinkIcon />
      <input ref={ref} type="text" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or name@example.com" aria-label="Link address" autoComplete="off" />
      <button type="submit" className="icon-btn" aria-label="Apply link" title="Apply" disabled={!normalizeUrl(url)}><Check /></button>
      {editor.isActive('link') && (
        <button type="button" className="icon-btn" aria-label="Remove link" title="Remove link" onClick={() => (editor.chain().focus().extendMarkRange('link').unsetLink().run(), onClose())}><Trash /></button>
      )}
      <button type="button" className="icon-btn" aria-label="Cancel" title="Cancel" onClick={() => (onClose(), editor.commands.focus())}><Close /></button>
    </form>
  )
}

interface Tool {
  key: string
  label: string
  shortcut?: string
  icon: ReactNode
  run: (c: ReturnType<Editor['chain']>, ed: Editor) => void
  active: (ed: Editor) => boolean
}

const TOOLS: (Tool | null)[] = [
  { key: 'bold', label: 'Bold', shortcut: `${MOD}B`, icon: <Bold />, run: (c) => c.toggleBold().run(), active: (e) => e.isActive('bold') },
  { key: 'italic', label: 'Italic', shortcut: `${MOD}I`, icon: <Italic />, run: (c) => c.toggleItalic().run(), active: (e) => e.isActive('italic') },
  { key: 'strike', label: 'Strikethrough', shortcut: `${MOD}⇧S`, icon: <Strike />, run: (c) => c.toggleStrike().run(), active: (e) => e.isActive('strike') },
  { key: 'code', label: 'Inline code', icon: <Code />, run: (c) => c.toggleCode().run(), active: (e) => e.isActive('code') },
  null,
  {
    key: 'heading', label: 'Heading (click again for a smaller one)', icon: <Heading />,
    run: (c, e) => (e.isActive('heading', { level: 2 }) ? c.setHeading({ level: 3 }).run() : e.isActive('heading', { level: 3 }) ? c.setParagraph().run() : c.setHeading({ level: 2 }).run()),
    active: (e) => e.isActive('heading'),
  },
  { key: 'ul', label: 'Bulleted list', icon: <ListUl />, run: (c) => c.toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { key: 'ol', label: 'Numbered list', icon: <ListOl />, run: (c) => c.toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { key: 'task', label: 'Task list', icon: <Task />, run: (c) => c.toggleTaskList().run(), active: (e) => e.isActive('taskList') },
  { key: 'quote', label: 'Quote', icon: <Quote />, run: (c) => c.toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
  null,
  { key: 'rule', label: 'Horizontal rule', icon: <Rule />, run: (c) => c.setHorizontalRule().run(), active: () => false },
]

/** Formatting buttons for a block editor. They show which formats are on at the cursor. */
export function RichToolbar({ editor, onLink, linkOn, children }: { editor: Editor | null; onLink: () => void; linkOn: boolean; children?: ReactNode }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? Object.fromEntries(TOOLS.filter((t): t is Tool => !!t).map((t) => [t.key, t.active(e)])) : {}),
  }) as Record<string, boolean> | null
  const link = useEditorState({ editor, selector: ({ editor: e }) => !!e?.isActive('link') })
  return (
    <div className="rich-bar" role="toolbar" aria-label="Formatting">
      <div className="rich-tools">
        {TOOLS.map((t, i) =>
          t ? (
            <button
              key={t.key}
              type="button"
              disabled={!editor}
              aria-pressed={!!on?.[t.key]}
              className={on?.[t.key] ? 'on' : ''}
              onMouseDown={(e) => e.preventDefault()} // keep the selection in the text while the button is pressed
              onClick={() => editor && t.run(editor.chain().focus(), editor)}
              title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
              aria-label={t.label}
            >
              {t.icon}
            </button>
          ) : (
            <span key={`sep${i}`} className="rich-sep" aria-hidden />
          ),
        )}
        <button type="button" disabled={!editor} className={link || linkOn ? 'on' : ''} aria-pressed={link || linkOn} onMouseDown={(e) => e.preventDefault()} onClick={onLink} title={`Link (${MOD}K)`} aria-label="Link">
          <LinkIcon />
        </button>
      </div>
      {children}
    </div>
  )
}
