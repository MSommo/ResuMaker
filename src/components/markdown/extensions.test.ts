// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { blockExtensions, inlineExtensions } from './extensions'

const roundTrip = (md: string, inline = false) => {
  const ed = new Editor({ extensions: inline ? inlineExtensions() : blockExtensions(), content: md })
  const out = (ed.storage as any).markdown.getMarkdown() as string
  ed.destroy()
  return out
}

describe('rich editor Markdown round trip', () => {
  it.each([
    'Lead engineer on the platform team.',
    'Built **fast** and *careful* things, ~~not~~ really.',
    '## Heading\n\nA paragraph.',
    '- one\n- two\n- three',
    '1. first\n2. second',
    '- [ ] todo\n- [x] done',
    '> quoted',
    'See [the site](https://example.com) now.',
    'line one\nline two',
    '---',
  ])('keeps %j', (md) => {
    expect(roundTrip(md).trim()).toBe(md)
  })

  it('keeps inline text on one line', () => {
    expect(roundTrip('Cut costs by **40%**, see [docs](https://example.com)', true).trim()).toBe('Cut costs by **40%**, see [docs](https://example.com)')
  })

  it('treats blank content as empty', () => {
    expect(roundTrip(' ', true).trim()).toBe('')
    expect(roundTrip('').trim()).toBe('')
  })
})
