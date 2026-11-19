export interface Country {
  code: string
  name: string
}

// Codes that Intl knows about but that are not countries.
const EXCLUDE = new Set(['ZZ', 'EU', 'UN', 'EZ', 'QO', 'XA', 'XB', 'AC', 'CP', 'DG', 'EA', 'IC', 'TA'])
let cache: Country[] | null = null

/** All countries, named by the browser's own data so no list has to be maintained. */
export function countries(): Country[] {
  if (cache) return cache
  const dn = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
  const out: Country[] = []
  for (let a = 65; a <= 90; a++)
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b)
      let name: string | undefined
      try {
        name = dn.of(code)
      } catch {
        continue
      }
      if (name && name !== code && !EXCLUDE.has(code)) out.push({ code, name })
    }
  return (cache = out.sort((x, y) => x.name.localeCompare(y.name)))
}

export const countryName = (code: string) => countries().find((c) => c.code === code)?.name ?? ''

export function countryCode(name: string): string {
  const n = name.trim().toLowerCase()
  if (['uk', 'u.k.', 'great britain', 'england', 'scotland', 'wales', 'northern ireland'].includes(n)) return 'GB'
  return countries().find((c) => c.name.toLowerCase() === n)?.code ?? ''
}

export const NATIONALITIES = [
  'Afghan', 'Albanian', 'Algerian', 'American', 'Argentine', 'Armenian', 'Australian', 'Austrian', 'Bangladeshi', 'Belgian',
  'Brazilian', 'British', 'Bulgarian', 'Canadian', 'Chilean', 'Chinese', 'Colombian', 'Croatian', 'Cuban', 'Czech', 'Danish',
  'Dutch', 'Egyptian', 'Emirati', 'Estonian', 'Filipino', 'Finnish', 'French', 'Georgian', 'German', 'Greek', 'Hungarian',
  'Icelandic', 'Indian', 'Indonesian', 'Iranian', 'Iraqi', 'Irish', 'Israeli', 'Italian', 'Japanese', 'Jordanian', 'Kenyan',
  'Korean', 'Latvian', 'Lebanese', 'Lithuanian', 'Luxembourgish', 'Malaysian', 'Maltese', 'Mexican', 'Moroccan', 'New Zealander',
  'Nigerian', 'Norwegian', 'Pakistani', 'Peruvian', 'Polish', 'Portuguese', 'Romanian', 'Russian', 'Saudi', 'Serbian',
  'Singaporean', 'Slovak', 'Slovenian', 'South African', 'Spanish', 'Swedish', 'Swiss', 'Syrian', 'Thai', 'Tunisian', 'Turkish',
  'Ukrainian', 'Uruguayan', 'Venezuelan', 'Vietnamese',
]
