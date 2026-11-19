import { countryName } from './countries'
import { formatDay } from './dates'
import type { Basics } from './types'

/** "224 Antrim Road" / "Belfast, BT15 2AN" / "United Kingdom" */
export const addressLines = (b: Basics) =>
  [b.address.street, [b.address.city, b.address.postcode].filter(Boolean).join(', '), countryName(b.address.country)].filter(Boolean)

/** "Belfast BT15 2AN, United Kingdom" */
export const locationLine = (b: Basics) =>
  [[b.address.city, b.address.postcode].filter(Boolean).join(' '), countryName(b.address.country)].filter(Boolean).join(', ')

export const birthLines = (b: Basics) => [formatDay(b.birthDate), b.birthPlace].filter(Boolean)

export const fullName = (b: Pick<Basics, 'firstName' | 'lastName'>) => [b.firstName, b.lastName].filter(Boolean).join(' ')
