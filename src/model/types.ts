export type Id = string
export const uid = (): Id => Math.random().toString(36).slice(2, 10)

/** A dated item in a timeline section (job, degree, course, award…). */
export interface Entry {
  id: Id
  title: string
  organisation: string
  location: string
  /** `YYYY-MM` (from the month picker). Legacy free text is tolerated. */
  start: string
  end: string
  /** Ongoing: renders "Present" instead of the end date. */
  current: boolean
  /** Bold highlight line under the dates. */
  note: string
  /** Formatted text (`**bold**`, `*italic*`). Blank line = new paragraph. */
  description: string
  /** One per line. A line starting with `#` is a subheading that groups the bullets after it. */
  bullets: string[]
}

export const emptyEntry = (): Entry => ({
  id: uid(),
  title: '',
  organisation: '',
  location: '',
  start: '',
  end: '',
  current: false,
  note: '',
  description: '',
  bullets: [],
})

/** Skill or language with a level from 1 to 5. */
export interface Leveled {
  id: Id
  name: string
  level: number
}

export interface LinkItem {
  id: Id
  label: string
  url: string
}

export interface Address {
  street: string
  city: string
  postcode: string
  /** ISO 3166-1 alpha-2, e.g. "GB". */
  country: string
}

/** Header and personal details. Always part of the CV; the "details" section just displays them. */
export interface Basics {
  firstName: string
  lastName: string
  headline: string
  email: string
  phone: string
  address: Address
  /** ISO date `YYYY-MM-DD`. */
  birthDate: string
  birthPlace: string
  nationality: string
}

export type SectionKind = 'details' | 'text' | 'entries' | 'levels' | 'links'

export type IconId = 'none' | 'user' | 'briefcase' | 'badge' | 'cap' | 'star' | 'bookmark'

interface SectionBase {
  id: Id
  title: string
  /** Layout zone the section is placed in, or `null` when it is stashed in the drawer (content kept). */
  zone: string | null
  /** Used by layouts that draw section icons. */
  icon: IconId
}

export type Section = SectionBase &
  (
    | { kind: 'details' }
    | { kind: 'text'; text: string }
    | { kind: 'entries'; items: Entry[]; /** Titles read "Role at Organisation". */ job: boolean }
    | { kind: 'levels'; items: Leveled[] }
    | { kind: 'links'; items: LinkItem[] }
  )

export interface Resume {
  layoutId: string
  basics: Basics
  sections: Section[]
}

export const KIND_LABEL: Record<SectionKind, string> = {
  details: 'Personal details',
  text: 'Text',
  entries: 'Timeline',
  levels: 'Skill levels',
  links: 'Links',
}

export const ICON_LABEL: Record<IconId, string> = {
  none: 'None',
  user: 'Person',
  briefcase: 'Briefcase',
  badge: 'Badge',
  cap: 'Graduation cap',
  star: 'Star',
  bookmark: 'Bookmark',
}

export const LEVEL_LABEL = ['', 'Basic', 'Fair', 'Good', 'Strong', 'Expert']
