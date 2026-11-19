import { useCallback, useRef, type KeyboardEvent } from 'react'
import { continueList, insertLink, toggleInline, type Edit } from './format'

export type Transform = (value: string, start: number, end: number) => Edit | null

/**
 * Applies text transforms to a textarea and restores the selection afterwards, plus the keyboard shortcuts:
 * ⌘/Ctrl+B bold, +I italic, +K link, +Shift+X strikethrough, and (multi-line fields) Enter to continue a list.
 */
export function useFormatting(value: string, onChange: (v: string) => void, { lists = true }: { lists?: boolean } = {}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const apply = useCallback(
    (fn: Transform) => {
      const el = ref.current
      if (!el) return
      const r = fn(value, el.selectionStart, el.selectionEnd)
      if (!r) return
      onChange(r.value)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(r.start, r.end)
      })
    },
    [value, onChange],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    const run = (fn: Transform) => (e.preventDefault(), apply(fn))
    if (mod && !e.shiftKey && key === 'b') return run((v, s, en) => toggleInline(v, s, en, '**'))
    if (mod && !e.shiftKey && key === 'i') return run((v, s, en) => toggleInline(v, s, en, '*'))
    if (mod && !e.shiftKey && key === 'k') return run(insertLink)
    if (mod && e.shiftKey && key === 'x') return run((v, s, en) => toggleInline(v, s, en, '~~'))
    if (lists && e.key === 'Enter' && !e.shiftKey && !mod && !e.nativeEvent.isComposing) {
      const el = e.currentTarget
      const r = continueList(value, el.selectionStart, el.selectionEnd)
      if (r) return run(() => r)
    }
  }

  return { ref, apply, onKeyDown }
}
