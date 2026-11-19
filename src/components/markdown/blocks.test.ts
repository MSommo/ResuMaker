import { describe, expect, it } from 'vitest'
import { splitBlocks } from './blocks'

const srcs = (md: string) => splitBlocks(md).map((b) => b.src)

describe('splitBlocks', () => {
  it('returns nothing for empty text', () => {
    expect(splitBlocks('')).toEqual([])
    expect(splitBlocks('  \n\n ')).toEqual([])
  })

  it('splits paragraphs, headings and rules into separate blocks', () => {
    expect(srcs('# Title\n\nFirst para\nstill first\n\nSecond\n\n---')).toEqual(['# Title', 'First para\nstill first', 'Second', '---'])
  })

  it('makes one block per list item so long lists can cross a page break', () => {
    expect(srcs('- a\n- b\n- c')).toEqual(['- a', '- b', '- c'])
  })

  it('keeps ordered numbering by keeping each item’s own marker', () => {
    expect(srcs('1. one\n2. two\n3. three')).toEqual(['1. one', '2. two', '3. three'])
  })

  it('keeps nested lists inside their parent item', () => {
    const [first, second] = srcs('- parent\n  - child\n  - child 2\n- other')
    expect(first).toBe('- parent\n  - child\n  - child 2')
    expect(second).toBe('- other')
  })

  it('marks every list item except the last of its list as tight', () => {
    expect(splitBlocks('- a\n- b\n- c').map((b) => b.tight)).toEqual([true, true, false])
    expect(splitBlocks('Intro\n\n- a\n- b\n\nOutro').map((b) => b.tight)).toEqual([false, true, false, false])
  })

  it('two separate lists are not tight across each other', () => {
    expect(splitBlocks('- a\n\ntext\n\n- b').map((b) => b.tight)).toEqual([false, false, false])
  })

  it('keeps a table as one block', () => {
    expect(srcs('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |')).toHaveLength(1)
  })

  it('keeps a fenced code block as one block even with blank lines inside', () => {
    expect(srcs('```\nline1\n\nline2\n```')).toHaveLength(1)
  })

  it('never emits raw HTML blocks', () => {
    expect(srcs('<script>alert(1)</script>\n\nhello')).toEqual(['hello'])
  })

  it('carries link reference definitions with every block that may use them', () => {
    const blocks = srcs('See [docs][d].\n\nMore text\n\n[d]: https://example.com')
    expect(blocks).toHaveLength(2)
    expect(blocks.every((b) => b.includes('[d]: https://example.com'))).toBe(true)
  })

  it('splits a list that follows a paragraph', () => {
    expect(srcs('Intro:\n\n- x\n- y')).toEqual(['Intro:', '- x', '- y'])
  })
})
