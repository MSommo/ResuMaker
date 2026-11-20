import { describe, expect, it } from 'vitest'
import { composePhone, detectCountry, dialLabel, flagOf, normalizeIntl, parsePhone, searchCountries } from './phone'

describe('detectCountry', () => {
  it('matches complete calling codes', () => {
    expect(detectCountry('39333')).toBe('IT')
    expect(detectCountry('447000')).toBe('GB')
    expect(detectCountry('34600')).toBe('ES')
    expect(detectCountry('353')).toBe('IE')
  })
  it('uses area codes for the shared +1', () => {
    expect(detectCountry('12125550100')).toBe('US')
    expect(detectCountry('14165550100')).toBe('CA')
    expect(detectCountry('12425550100')).toBe('BS')
  })
  it('splits Russia and Kazakhstan', () => {
    expect(detectCountry('79161234567')).toBe('RU')
    expect(detectCountry('77011234567')).toBe('KZ')
  })
  it('does not guess from an incomplete code', () => {
    expect(detectCountry('2')).toBeNull()
    expect(detectCountry('21')).toBeNull()
  })
})

describe('parsePhone / composePhone', () => {
  it('recognises the country and strips the code', () => {
    expect(parsePhone('+44 7000 000000')).toEqual({ iso: 'GB', national: '7000 000000' })
    expect(parsePhone('+39333 1234567')).toEqual({ iso: 'IT', national: '333 1234567' })
    expect(parsePhone('0039 333 1234567')).toEqual({ iso: 'IT', national: '333 1234567' })
  })
  it('keeps a trailing space while typing', () => {
    expect(parsePhone('+39 333 ')).toEqual({ iso: 'IT', national: '333 ' })
    expect(parsePhone(composePhone('IT', '333 12'))).toEqual({ iso: 'IT', national: '333 12' })
  })
  it('leaves numbers without a prefix alone', () => {
    expect(parsePhone('07700 900123')).toEqual({ iso: null, national: '07700 900123' })
  })
  it('uses the preferred country for an empty value', () => {
    expect(parsePhone('', 'FR')).toEqual({ iso: 'FR', national: '' })
  })
  it('keeps a picked country when its code matches', () => {
    expect(parsePhone('+1 212 555 0100', 'CA').iso).toBe('CA')
    expect(parsePhone('+1 212 555 0100').iso).toBe('US')
  })
  it('round-trips', () => {
    expect(composePhone('IT', '333 1234567')).toBe('+39 333 1234567')
    expect(parsePhone(composePhone('BS', '555 1234')).iso).toBe('BS')
    expect(composePhone('IT', '  ')).toBe('')
    expect(composePhone(null, '0770')).toBe('0770')
  })
})

describe('helpers', () => {
  it('formats labels and flags', () => {
    expect(dialLabel('39')).toBe('+39')
    expect(dialLabel('1242')).toBe('+1 242')
    expect(flagOf('IT')).toBe('🇮🇹')
    expect(normalizeIntl('0044 20')).toBe('+44 20')
    expect(normalizeIntl('0123')).toBe('0123')
  })
  it('searches by name and by code', () => {
    expect(searchCountries('ital')[0].code).toBe('IT')
    expect(searchCountries('+39').map((c) => c.code)).toContain('IT')
    expect(searchCountries('44').map((c) => c.code)).toContain('GB')
    expect(searchCountries('zzzz')).toEqual([])
  })
})
