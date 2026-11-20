import type { ComponentType } from 'react'
import type { Resume, SectionKind } from '../model/types'
import { SidebarLayout } from './sidebar/SidebarLayout'
import { TimelineLayout } from './timeline/TimelineLayout'

/** A region of a layout that sections can be placed in. */
export interface Zone {
  id: string
  label: string
  hint: string
  /** What may be placed here. An entry is a section kind ('details'), or `kind:icon` ('text:user' = the Profile text block, recognised by its person icon). */
  accepts: string[]
}

/** Whether a section of this kind and icon may go in `zone`. */
export const accepts = (zone: Zone, kind: SectionKind, icon: string = 'none') => zone.accepts.includes(kind) || zone.accepts.includes(`${kind}:${icon}`)

export interface LayoutDef {
  id: string
  name: string
  description: string
  zones: Zone[]
  /** The layout draws an icon next to each section title, so the editor offers an icon picker. */
  icons?: boolean
  Component: ComponentType<{ resume: Resume }>
}

const SIDE: Zone = { id: 'side', label: 'Sidebar', hint: 'Narrow column: details, skills, links, short text', accepts: ['details', 'text', 'levels', 'links'] }
const MAIN: Zone = { id: 'main', label: 'Main column', hint: 'Wide column: profile and dated entries', accepts: ['text', 'entries'] }

/** A few pre-determined components may sit in the CV's header, under the name. Keep it LAST in `zones`: nothing is auto-placed into it. */
const HEADER: Zone = { id: 'header', label: 'Header', hint: 'Profile or Personal details, under your name', accepts: ['details', 'text:user'] }

/** Add new layouts here; the editor, drawer and home gallery pick them up automatically. */
export const layouts: LayoutDef[] = [
  {
    id: 'sidebar',
    name: 'Sidebar',
    description: 'Two columns: details, skills and links on the left, experience on the right.',
    zones: [SIDE, MAIN, HEADER],
    Component: SidebarLayout,
  },
  {
    id: 'timeline',
    name: 'Timeline',
    description: 'Centered header, narrow centered sidebar and a timeline of dated entries.',
    zones: [SIDE, MAIN, HEADER],
    icons: true,
    Component: TimelineLayout,
  },
]

export const getLayout = (id: string) => layouts.find((l) => l.id === id) ?? layouts[0]
