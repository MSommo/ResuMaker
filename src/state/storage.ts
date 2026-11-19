import { countryCode } from '../model/countries'
import { parseLooseDay, parseLooseMonth } from '../model/dates'
import { TEMPLATES } from '../model/templates'
import { uid, type Entry, type Resume, type Section } from '../model/types'

const KEY = 'resumaker:resume:v2'
const KEY_V1 = 'resumaker:resume:v1'

const isResume = (x: any): x is Resume => x && Array.isArray(x.sections) && x.basics && typeof x.layoutId === 'string'

/** A CV saved in this browser by an earlier (server-less) version of the app, if any. Used for the one-time import. */
export function readLocalResume(): Resume | null {
  try {
    const v2 = localStorage.getItem(KEY)
    if (v2) {
      const parsed = JSON.parse(v2)
      if (isResume(parsed)) return parsed
    }
    const v1 = localStorage.getItem(KEY_V1)
    if (v1) return migrateV1(JSON.parse(v1))
  } catch {
    /* corrupt or unavailable storage */
  }
  return null
}

/** Parse imported JSON (current or v1 format); throws on anything unusable. */
export function parseImport(text: string): Resume {
  const x = JSON.parse(text)
  if (isResume(x)) return x
  if (x && x.basics && 'profile' in x) return migrateV1(x)
  throw new Error('Not a ResuMaker file')
}

const PLACEMENT: Record<string, string> = {
  details: 'side', skills: 'side', languages: 'side', links: 'side', hobbies: 'side',
  profile: 'main', employment: 'main', education: 'main', courses: 'main', achievements: 'main',
}

/** v1 stored fixed fields plus a `hidden` list and free-text dates/addresses. */
export function migrateV1(old: any): Resume {
  const lines = String(old.basics?.addressLines ?? '').split('\n').map((l: string) => l.trim()).filter(Boolean)
  // "Belfast, BT15 2AN" or "Belfast BT15 2AN" → city + UK postcode; otherwise split on the first comma.
  const cityLine = lines[1] ?? ''
  const uk = /^(.*?)[,\s]+([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i.exec(cityLine)
  const [city, pc] = uk ? [uk[1], uk[2]] : [cityLine.split(/,\s*/)[0], cityLine.split(/,\s*/).slice(1).join(', ')]
  const birth = String(old.basics?.birth ?? '').split('\n')
  const hidden: string[] = old.hidden ?? []
  const entries = (items: any[] = []): Entry[] =>
    items.map((e) => ({
      id: e.id ?? uid(), title: e.title ?? '', organisation: e.organisation ?? '', location: e.location ?? '',
      start: parseLooseMonth(e.start ?? ''), end: /present/i.test(e.end ?? '') ? '' : parseLooseMonth(e.end ?? ''),
      current: /present/i.test(e.end ?? ''), note: e.note ?? '', description: e.description ?? '', bullets: e.bullets ?? [],
    }))
  const content: Record<string, Partial<Section>> = {
    profile: { text: old.profile ?? '' } as Partial<Section>,
    employment: { items: entries(old.employment) } as Partial<Section>,
    education: { items: entries(old.education) } as Partial<Section>,
    courses: { items: entries(old.courses) } as Partial<Section>,
    achievements: { items: entries(old.achievements) } as Partial<Section>,
    skills: { items: old.skills ?? [] } as Partial<Section>,
    languages: { items: old.languages ?? [] } as Partial<Section>,
    links: { items: old.links ?? [] } as Partial<Section>,
    hobbies: { text: old.hobbies ?? '' } as Partial<Section>,
  }
  const sections = Object.keys(PLACEMENT).map((tid) => {
    const t = TEMPLATES.find((x) => x.id === tid)!
    const title = old.sectionTitles?.[tid === 'achievements' ? 'achievements' : tid]
    return { ...t.make(), ...content[tid], ...(title ? { title } : {}), zone: hidden.includes(tid) ? null : PLACEMENT[tid] } as Section
  })
  const b = old.basics ?? {}
  return {
    layoutId: old.layoutId ?? 'sidebar',
    basics: {
      firstName: b.firstName ?? '', lastName: b.lastName ?? '', headline: b.headline ?? '', email: b.email ?? '', phone: b.phone ?? '',
      address: { street: lines[0] ?? '', city: city ?? '', postcode: pc, country: countryCode(lines[2] ?? '') },
      birthDate: parseLooseDay(birth[0] ?? ''), birthPlace: birth[1] ?? '', nationality: b.nationality ?? '',
    },
    sections,
  }
}
