import type { ComponentType } from 'react'
import type { Resume, SectionKind } from '../model/types'
import { SidebarLayout } from './sidebar/SidebarLayout'
import { TimelineLayout } from './timeline/TimelineLayout'
import { AtelierLayout } from './atelier/AtelierLayout'
import { BillboardLayout } from './billboard/BillboardLayout'
import { BlueprintLayout } from './blueprint/BlueprintLayout'
import { CampusLayout } from './campus/CampusLayout'
import { ChambersLayout } from './chambers/ChambersLayout'
import { ChangelogLayout } from './changelog/ChangelogLayout'
import { ClinicLayout } from './clinic/ClinicLayout'
import { ConciergeLayout } from './concierge/ConciergeLayout'
import { DatasheetLayout } from './datasheet/DatasheetLayout'
import { DocumentLayout } from './document/DocumentLayout'
import { EditorialLayout } from './editorial/EditorialLayout'
import { ExhibitLayout } from './exhibit/ExhibitLayout'
import { LedgerLayout } from './ledger/LedgerLayout'
import { PlainLayout } from './plain/PlainLayout'
import { RisoLayout } from './riso/RisoLayout'
import { RoadmapLayout } from './roadmap/RoadmapLayout'
import { SwissLayout } from './swiss/SwissLayout'
import { TerminalLayout } from './terminal/TerminalLayout'

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
    name: 'Monolith',
    description: 'Bold black capitals over two columns: details, skills and links on the left, experience on the right.',
    zones: [SIDE, MAIN, HEADER],
    Component: SidebarLayout,
  },
  {
    id: 'timeline',
    name: 'Waypoints',
    description: 'A centred header, a narrow centred sidebar and a vertical line of dated waypoints.',
    zones: [SIDE, MAIN, HEADER],
    icons: true,
    Component: TimelineLayout,
  },
  {
    id: 'document',
    name: 'JSON Document',
    description: 'The CV as a stored JSON document: keys, nesting, brackets and syntax colours in monospace.',
    zones: [SIDE, MAIN, HEADER],
    Component: DocumentLayout,
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'A dark shell session: prompt lines, commands and output, in phosphor green on black.',
    zones: [SIDE, MAIN, HEADER],
    Component: TerminalLayout,
  },
  {
    id: 'ledger',
    name: 'Data Ledger',
    description: 'Tabular and exact: ruled rows, tabular figures and a restrained blue accent.',
    zones: [SIDE, MAIN, HEADER],
    icons: true,
    Component: LedgerLayout,
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    description: 'Engineering drawing: blueprint-blue page, drafting grid, title block and dimension lines.',
    zones: [SIDE, MAIN, HEADER],
    Component: BlueprintLayout,
  },
  {
    id: 'roadmap',
    name: 'Roadmap',
    description: 'Numbered phases on a milestone track, with the clarity a product manager likes.',
    zones: [SIDE, MAIN, HEADER],
    icons: true,
    Component: RoadmapLayout,
  },
  {
    id: 'datasheet',
    name: 'Datasheet',
    description: 'A component datasheet: dense boxed tables, spec rows and a part-number header.',
    zones: [SIDE, MAIN, HEADER],
    Component: DatasheetLayout,
  },
  {
    id: 'changelog',
    name: 'Changelog',
    description: 'Release notes: version-style date gutter, entries as tagged releases.',
    zones: [SIDE, MAIN, HEADER],
    Component: ChangelogLayout,
  },
  {
    id: 'swiss',
    name: 'Swiss Grid',
    description: 'International style: a strict grid, oversized numerals and one signal red.',
    zones: [SIDE, MAIN, HEADER],
    Component: SwissLayout,
  },
  {
    id: 'plain',
    name: 'Plain',
    description: 'One quiet column, no colour, no decoration: the safest layout for applicant tracking systems.',
    zones: [SIDE, MAIN, HEADER],
    Component: PlainLayout,
  },
  {
    id: 'atelier',
    name: 'Atelier',
    description: 'A design studio: large serif name, generous white space and one coral accent.',
    zones: [SIDE, MAIN, HEADER],
    Component: AtelierLayout,
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'A magazine masthead: bold serif headlines, column rules and a standfirst.',
    zones: [SIDE, MAIN, HEADER],
    Component: EditorialLayout,
  },
  {
    id: 'billboard',
    name: 'Billboard',
    description: 'Loud and confident for sales and marketing: a solid colour banner and big, punchy headings.',
    zones: [SIDE, MAIN, HEADER],
    icons: true,
    Component: BillboardLayout,
  },
  {
    id: 'clinic',
    name: 'Clinic',
    description: 'Calm and clear for healthcare: soft teal, rounded panels and gentle section tags.',
    zones: [SIDE, MAIN, HEADER],
    icons: true,
    Component: ClinicLayout,
  },
  {
    id: 'campus',
    name: 'Campus',
    description: 'Warm and friendly for teachers and trainers: rounded type, colour-coded section tabs.',
    zones: [SIDE, MAIN, HEADER],
    icons: true,
    Component: CampusLayout,
  },
  {
    id: 'concierge',
    name: 'Concierge',
    description: 'Refined hospitality: centred small-caps serif, gold hairlines and ornamental dividers.',
    zones: [SIDE, MAIN, HEADER],
    icons: true,
    Component: ConciergeLayout,
  },
  {
    id: 'chambers',
    name: 'Chambers',
    description: 'Traditional legal style: justified serif text, numbered sections and formal rules.',
    zones: [SIDE, MAIN, HEADER],
    Component: ChambersLayout,
  },
  {
    id: 'exhibit',
    name: 'Exhibit',
    description: 'A gallery wall for artists: asymmetric, mono captions like museum labels, one neon accent.',
    zones: [SIDE, MAIN, HEADER],
    icons: true,
    Component: ExhibitLayout,
  },
  {
    id: 'riso',
    name: 'Risograph',
    description: 'Two-colour print: overprinting pink and blue shapes, grainy and playful.',
    zones: [SIDE, MAIN, HEADER],
    icons: true,
    Component: RisoLayout,
  },
]

export const getLayout = (id: string) => layouts.find((l) => l.id === id) ?? layouts[0]
