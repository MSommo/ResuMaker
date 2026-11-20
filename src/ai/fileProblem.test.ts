import { describe, expect, it } from 'vitest'
import { fileProblem } from './ImportPanel'

const f = (name: string, size = 1000) => new File([new Uint8Array(size)], name)

describe('fileProblem', () => {
  it('accepts PDF, DOCX and HTML', () => {
    for (const n of ['cv.pdf', 'CV.DOCX', 'cv.html', 'cv.htm']) expect(fileProblem(f(n))).toBe('')
  })
  it('explains what is wrong with anything else', () => {
    expect(fileProblem(f('cv.doc'))).toMatch(/save it as DOCX or PDF/)
    expect(fileProblem(f('cv.png'))).toMatch(/PDF, DOCX or HTML/)
    expect(fileProblem(f('cv.pdf', 0))).toMatch(/empty/)
    expect(fileProblem(f('cv.pdf', 11 * 1024 * 1024))).toMatch(/10 MB/)
  })
})
