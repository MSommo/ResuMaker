import { describe, expect, it } from 'vitest'
import { timeAgo } from './relativeTime'

const now = new Date('2026-11-20T12:00:00Z')
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString()

describe('timeAgo', () => {
  it('says "just now" under a minute', () => expect(timeAgo(ago(30), now, 'en')).toBe('just now'))
  it('counts minutes and hours', () => {
    expect(timeAgo(ago(5 * 60), now, 'en')).toBe('5 minutes ago')
    expect(timeAgo(ago(3 * 3600), now, 'en')).toBe('3 hours ago')
  })
  it('uses words for one day', () => expect(timeAgo(ago(26 * 3600), now, 'en')).toBe('yesterday'))
  it('rounds down to the largest whole unit', () => {
    expect(timeAgo(ago(10 * 24 * 3600), now, 'en')).toBe('last week')
    expect(timeAgo(ago(400 * 24 * 3600), now, 'en')).toBe('last year')
  })
})
