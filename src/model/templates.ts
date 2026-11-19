import { uid, type IconId, type Section, type SectionKind } from './types'

/** A component in the drawer. Dropping it into the CV creates a fresh section from `make`. */
export interface Template {
  id: string
  label: string
  blurb: string
  kind: SectionKind
  /** Zone it prefers when added with the "+" button. */
  zone: 'side' | 'main'
  make: () => Section
}

const base = (title: string, icon: IconId) => ({ id: uid(), title, zone: null, icon })

export const TEMPLATES: Template[] = [
  { id: 'details', label: 'Personal details', blurb: 'Address, phone, email, birth, nationality', kind: 'details', zone: 'side', make: () => ({ ...base('Details', 'none'), kind: 'details' }) },
  { id: 'profile', label: 'Profile', blurb: 'A short bio', kind: 'text', zone: 'main', make: () => ({ ...base('Profile', 'user'), kind: 'text', text: '' }) },
  { id: 'employment', label: 'Employment history', blurb: 'Jobs with highlights', kind: 'entries', zone: 'main', make: () => ({ ...base('Employment History', 'briefcase'), kind: 'entries', items: [], job: true }) },
  { id: 'education', label: 'Education', blurb: 'Degrees and diplomas', kind: 'entries', zone: 'main', make: () => ({ ...base('Education', 'cap'), kind: 'entries', items: [], job: false }) },
  { id: 'courses', label: 'Courses', blurb: 'Certifications and training', kind: 'entries', zone: 'main', make: () => ({ ...base('Courses', 'badge'), kind: 'entries', items: [], job: false }) },
  { id: 'achievements', label: 'Achievements', blurb: 'Awards and recognition', kind: 'entries', zone: 'main', make: () => ({ ...base('Achievement', 'star'), kind: 'entries', items: [], job: false }) },
  { id: 'skills', label: 'Skills', blurb: 'Skills with levels', kind: 'levels', zone: 'side', make: () => ({ ...base('Skills', 'none'), kind: 'levels', items: [] }) },
  { id: 'languages', label: 'Languages', blurb: 'Spoken (or programming) languages', kind: 'levels', zone: 'side', make: () => ({ ...base('Languages', 'none'), kind: 'levels', items: [] }) },
  { id: 'links', label: 'Links', blurb: 'LinkedIn, GitHub, portfolio…', kind: 'links', zone: 'side', make: () => ({ ...base('Links', 'none'), kind: 'links', items: [] }) },
  { id: 'hobbies', label: 'Hobbies', blurb: 'Interests', kind: 'text', zone: 'side', make: () => ({ ...base('Hobbies', 'none'), kind: 'text', text: '' }) },
  { id: 'custom-text', label: 'Custom text', blurb: 'Any free text block', kind: 'text', zone: 'main', make: () => ({ ...base('New section', 'bookmark'), kind: 'text', text: '' }) },
  { id: 'custom-timeline', label: 'Custom timeline', blurb: 'Projects, volunteering, publications…', kind: 'entries', zone: 'main', make: () => ({ ...base('New timeline', 'bookmark'), kind: 'entries', items: [], job: false }) },
  { id: 'custom-levels', label: 'Custom skill list', blurb: 'Any list with levels', kind: 'levels', zone: 'side', make: () => ({ ...base('New list', 'none'), kind: 'levels', items: [] }) },
  { id: 'custom-links', label: 'Custom links', blurb: 'Any list of links', kind: 'links', zone: 'side', make: () => ({ ...base('New links', 'none'), kind: 'links', items: [] }) },
]

export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id)
