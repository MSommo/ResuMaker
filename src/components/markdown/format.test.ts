import { describe, expect, it } from 'vitest'
import { continueList, cycleHeading, insertLink, insertRule, toggleInline, toggleLines } from './format'

/** Helper: select the text between `[` and `]` in the fixture and return value + selection. */
const sel = (s: string) => {
  const start = s.indexOf('[')
  const end = s.indexOf(']') - 1
  return { value: s.replace('[', '').replace(']', ''), start, end }
}

describe('toggleInline', () => {
  it('wraps a selection', () => {
    const { value, start, end } = sel('say [hello] now')
    const r = toggleInline(value, start, end, '**')
    expect(r.value).toBe('say **hello** now')
    expect(r.value.slice(r.start, r.end)).toBe('hello')
  })

  it('inserts a placeholder when nothing is selected and selects it', () => {
    const r = toggleInline('ab', 1, 1, '*')
    expect(r.value).toBe('a*text*b')
    expect(r.value.slice(r.start, r.end)).toBe('text')
  })

  it('unwraps when the selection includes the markers', () => {
    const r = toggleInline('**hi**', 0, 6, '**')
    expect(r.value).toBe('hi')
  })

  it('unwraps when the markers are just outside the selection', () => {
    const r = toggleInline('a **hi** b', 4, 6, '**')
    expect(r.value).toBe('a hi b')
    expect(r.value.slice(r.start, r.end)).toBe('hi')
  })

  it('does not treat **bold** as already italic', () => {
    const r = toggleInline('**hi**', 0, 6, '*')
    expect(r.value).toBe('***hi***')
  })

  it('italic inside bold text wraps instead of unwrapping the bold', () => {
    const r = toggleInline('**hi**', 2, 4, '*')
    expect(r.value).toBe('***hi***')
  })

  it('works for strikethrough', () => {
    expect(toggleInline('x old y', 2, 5, '~~').value).toBe('x ~~old~~ y')
  })
})

describe('toggleLines', () => {
  it('makes every selected line a bullet, skipping blank lines', () => {
    const r = toggleLines('a\n\nb', 0, 4, 'ul')
    expect(r.value).toBe('- a\n\n- b')
  })

  it('numbers ordered lists', () => {
    expect(toggleLines('a\nb\nc', 0, 5, 'ol').value).toBe('1. a\n2. b\n3. c')
  })

  it('toggles off when every line already has the prefix', () => {
    expect(toggleLines('- a\n- b', 0, 7, 'ul').value).toBe('a\nb')
  })

  it('switches list kinds instead of stacking them', () => {
    expect(toggleLines('- a\n- b', 0, 7, 'ol').value).toBe('1. a\n2. b')
    expect(toggleLines('1. a', 0, 4, 'task').value).toBe('- [ ] a')
  })

  it('quotes combine with lists', () => {
    expect(toggleLines('- a', 0, 3, 'quote').value).toBe('> - a')
  })

  it('acts on the whole line even if only part of it is selected', () => {
    expect(toggleLines('hello world', 3, 5, 'ul').value).toBe('- hello world')
  })

  it('keeps indentation', () => {
    expect(toggleLines('  a', 2, 3, 'ul').value).toBe('  - a')
  })
})

describe('cycleHeading', () => {
  it('cycles plain → ## → ### → plain', () => {
    const a = cycleHeading('Title', 2, 2)
    expect(a.value).toBe('## Title')
    const b = cycleHeading(a.value, a.start, a.end)
    expect(b.value).toBe('### Title')
    const c = cycleHeading(b.value, b.start, b.end)
    expect(c.value).toBe('Title')
  })

  it('only changes the current line', () => {
    expect(cycleHeading('one\ntwo', 5, 5).value).toBe('one\n## two')
  })
})

describe('insertLink', () => {
  it('wraps the selection and selects the url', () => {
    const r = insertLink('see docs here', 4, 8)
    expect(r.value).toBe('see [docs](https://) here')
    expect(r.value.slice(r.start, r.end)).toBe('https://')
  })

  it('uses a selected URL as the target', () => {
    const r = insertLink('https://example.com', 0, 19)
    expect(r.value).toBe('[link](https://example.com)')
    expect(r.value.slice(r.start, r.end)).toBe('link')
  })

  it('inserts a template when nothing is selected', () => {
    expect(insertLink('', 0, 0).value).toBe('[link text](https://)')
  })
})

describe('insertRule', () => {
  it('surrounds the rule with blank lines', () => {
    expect(insertRule('a', 1, 1).value).toBe('a\n\n---')
    expect(insertRule('a\nb', 2, 2).value).toBe('a\n\n---\nb'.replace('\nb', '\n\nb'))
  })
})

describe('continueList', () => {
  it('starts the next bullet', () => {
    const r = continueList('- one', 5, 5)!
    expect(r.value).toBe('- one\n- ')
    expect(r.start).toBe(r.value.length)
  })

  it('increments ordered numbers', () => {
    expect(continueList('1. one\n2. two', 13, 13)!.value).toBe('1. one\n2. two\n3. ')
  })

  it('continues task lists with an unchecked box', () => {
    expect(continueList('- [x] done', 10, 10)!.value).toBe('- [x] done\n- [ ] ')
  })

  it('keeps indentation of nested items', () => {
    expect(continueList('- a\n  - b', 9, 9)!.value).toBe('- a\n  - b\n  - ')
  })

  it('ends the list when Enter is pressed on an empty item, leaving a blank line so the next text is its own paragraph', () => {
    const r = continueList('- one\n- ', 8, 8)!
    expect(r.value).toBe('- one\n\n')
    expect(r.start).toBe(r.value.length)
  })

  it('does not add a second blank line when one is already there', () => {
    expect(continueList('text\n\n- ', 8, 8)!.value).toBe('text\n\n')
  })

  it('removes a lone empty marker at the very start', () => {
    expect(continueList('- ', 2, 2)!.value).toBe('')
  })

  it('leaves normal text, selections and mid-line cursors to the browser', () => {
    expect(continueList('plain', 5, 5)).toBeNull()
    expect(continueList('- one', 0, 5)).toBeNull()
    expect(continueList('- one two', 5, 5)).toBeNull()
  })
})
