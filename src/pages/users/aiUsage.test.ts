import { describe, expect, it } from 'vitest'
import type { AiUsageSummary } from '../../api/client'
import { count, hasUsage, limitState, usd } from './AiUsage'

const summary = (over: Partial<AiUsageSummary> = {}): AiUsageSummary => ({
  today: 0, week: 0, month: 0, tokens: 0, costUsd: 0, errors: 0, rejected: 0, offTopicShare: null, lastUsedAt: null, dailyLimit: 300, ...over,
})

describe('AI usage on the Users page', () => {
  it('flags people near or at the daily limit', () => {
    expect(limitState(summary({ today: 100 }))).toBe('ok')
    expect(limitState(summary({ today: 240 }))).toBe('near') // 80%
    expect(limitState(summary({ today: 300 }))).toBe('over')
    expect(limitState(summary({ today: 999, dailyLimit: 0 }))).toBe('ok') // 0 = unlimited
    expect(limitState(null)).toBe('ok')
  })

  it('only offers the detail when there is something to show', () => {
    expect(hasUsage(summary())).toBe(false)
    expect(hasUsage(summary({ rejected: 2 }))).toBe(true) // refused attempts are worth seeing too
    expect(hasUsage(summary({ lastUsedAt: '2026-01-01T00:00:00Z' }))).toBe(true) // used, but over 30 days ago
  })

  it('formats costs and counts for a glance', () => {
    expect(usd(0)).toBe('$0')
    expect(usd(0.004)).toBe('<$0.01')
    expect(usd(1.444)).toBe('$1.44')
    expect(usd(123.4)).toBe('$123')
    expect(count(9_999)).toBe((9_999).toLocaleString())
    expect(count(888_100)).toMatch(/^888\.1\s?[kK]$/)
  })
})
