/**
 * Pure text transforms behind the editor's formatting toolbar. Each takes the text and the selection and returns the new
 * text and selection, so they can be unit-tested without a DOM.
 */
export interface Edit {
  value: string
  start: number
  end: number
}

const lineBounds = (value: string, start: number, end: number): [number, number] => {
  const from = value.lastIndexOf('\n', start - 1) + 1
  // A selection that ends right after a newline doesn't include the next line.
  const e = end > start && value[end - 1] === '\n' ? end - 1 : end
  const nl = value.indexOf('\n', e)
  return [from, nl === -1 ? value.length : nl]
}

/** Wrap the selection in `marker` (e.g. `**`), or remove the marker if it is already there. */
export function toggleInline(value: string, start: number, end: number, marker: string, placeholder = 'text'): Edit {
  const m = marker.length
  const sel = value.slice(start, end)
  // For `*`, a `**bold**` selection is not "already italic".
  const wrapped = (s: string) =>
    s.length >= 2 * m && s.startsWith(marker) && s.endsWith(marker) && !(marker === '*' && s.startsWith('**') && s.endsWith('**') && !(s.startsWith('***') && s.endsWith('***')))
  if (sel && wrapped(sel)) {
    const inner = sel.slice(m, -m)
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length }
  }
  const outside = value.slice(start - m, start) === marker && value.slice(end, end + m) === marker
  const dbl = marker === '*' && value.slice(start - 2, start) === '**' && value.slice(end, end + 2) === '**'
  if (outside && !dbl) {
    return { value: value.slice(0, start - m) + sel + value.slice(end + m), start: start - m, end: end - m }
  }
  const text = sel || placeholder
  const out = value.slice(0, start) + marker + text + marker + value.slice(end)
  return { value: out, start: start + m, end: start + m + text.length }
}

const PREFIX = {
  ul: /^(\s*)[-*+] (?!\[[ xX]\] )/,
  task: /^(\s*)[-*+] \[[ xX]\] /,
  ol: /^(\s*)\d+[.)] /,
  quote: /^(\s*)> ?/,
} as const
type LineKind = keyof typeof PREFIX

/** Toggle a list / quote prefix on every line touched by the selection. Lists are mutually exclusive; quotes combine with them. */
export function toggleLines(value: string, start: number, end: number, kind: LineKind): Edit {
  const [from, to] = lineBounds(value, start, end)
  const lines = value.slice(from, to).split('\n')
  const content = lines.filter((l) => l.trim())
  const allHave = content.length > 0 && content.every((l) => PREFIX[kind].test(l))
  const listKinds: LineKind[] = ['ul', 'task', 'ol']
  let n = 0
  const out = lines.map((line) => {
    if (!line.trim()) return line
    let l = line
    if (allHave) return l.replace(PREFIX[kind], '$1')
    if (kind !== 'quote') for (const k of listKinds) l = l.replace(PREFIX[k], '$1')
    const indent = /^\s*/.exec(l)![0]
    const body = l.slice(indent.length)
    n++
    return indent + (kind === 'ul' ? '- ' : kind === 'task' ? '- [ ] ' : kind === 'ol' ? `${n}. ` : '> ') + body
  })
  const text = out.join('\n')
  return { value: value.slice(0, from) + text + value.slice(to), start: from, end: from + text.length }
}

/** Cycle the current line through `##` → `###` → plain. */
export function cycleHeading(value: string, start: number, end: number): Edit {
  const [from, to] = lineBounds(value, start, start)
  const line = value.slice(from, to)
  const m = /^(#{1,6}) /.exec(line)
  const body = m ? line.slice(m[0].length) : line
  const next = !m ? '## ' : m[1].length === 2 ? '### ' : ''
  const text = next + body
  const delta = text.length - line.length
  return { value: value.slice(0, from) + text + value.slice(to), start: Math.max(from, start + delta), end: Math.max(from, end + delta) }
}

/** `[selection](url)` with the url selected, or `[text](url)` when nothing is selected. A selected URL becomes the target. */
export function insertLink(value: string, start: number, end: number): Edit {
  const sel = value.slice(start, end)
  if (/^https?:\/\/\S+$/.test(sel)) {
    const out = value.slice(0, start) + `[link](${sel})` + value.slice(end)
    return { value: out, start: start + 1, end: start + 5 }
  }
  const label = sel || 'link text'
  const url = 'https://'
  const out = value.slice(0, start) + `[${label}](${url})` + value.slice(end)
  const urlStart = start + label.length + 3
  return { value: out, start: urlStart, end: urlStart + url.length }
}

export function insertRule(value: string, start: number, end: number): Edit {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const pre = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const post = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const text = `${pre}---${post}`
  return { value: before + text + after, start: start + text.length, end: start + text.length }
}

const LIST_LINE = /^(\s*)([-*+]|\d+[.)])( \[[ xX]\])? (.*)$/

/** Enter inside a list item: start the next item (numbers increment), or end the list if the item is empty. null = let the browser handle it. */
export function continueList(value: string, start: number, end: number): Edit | null {
  if (start !== end) return null
  const [from, to] = lineBounds(value, start, start)
  if (start !== to) return null // only at the end of the line
  const m = LIST_LINE.exec(value.slice(from, to))
  if (!m) return null
  const [, indent, marker, task, text] = m
  if (!text.trim()) {
    // Empty item: remove the marker, ending the list. A blank line is left behind: without it, the next line would be
    // parsed as a lazy continuation of the last item instead of a new paragraph.
    const before = value.slice(0, from)
    const gap = before && !before.endsWith('\n\n') ? '\n' : ''
    return { value: before + gap + value.slice(to), start: from + gap.length, end: from + gap.length }
  }
  const next = /^\d/.test(marker) ? `${parseInt(marker, 10) + 1}${marker.slice(-1)}` : marker
  const insert = `\n${indent}${next}${task ? ' [ ]' : ''} `
  return { value: value.slice(0, to) + insert + value.slice(to), start: to + insert.length, end: to + insert.length }
}
