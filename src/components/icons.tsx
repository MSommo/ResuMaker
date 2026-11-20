import type { ReactNode, SVGProps } from 'react'
import type { SectionKind } from '../model/types'

type P = SVGProps<SVGSVGElement>
const I = ({ children, ...p }: P & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    {children}
  </svg>
)

export const Grip = (p: P) => <I {...p}><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></I>
export const Plus = (p: P) => <I {...p}><path d="M12 5v14M5 12h14" /></I>
export const Close = (p: P) => <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>
export const Trash = (p: P) => <I {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></I>
export const Back = (p: P) => <I {...p}><path d="M15 6l-6 6 6 6" /></I>
export const Chevron = (p: P) => <I {...p}><path d="M9 6l6 6-6 6" /></I>
export const Up = (p: P) => <I {...p}><path d="M6 15l6-6 6 6" /></I>
export const Down = (p: P) => <I {...p}><path d="M6 9l6 6 6-6" /></I>
export const Menu = (p: P) => <I {...p}><path d="M4 7h16M4 12h16M4 17h16" /></I>
export const Print = (p: P) => <I {...p}><path d="M7 9V3h10v6M7 17H4v-6h16v6h-3M7 14h10v7H7z" /></I>
export const Expand = (p: P) => <I {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></I>
export const Layers = (p: P) => <I {...p}><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" /></I>
export const Bold = (p: P) => <I {...p} strokeWidth="2.4"><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" /></I>
export const Italic = (p: P) => <I {...p}><path d="M10 5h8M6 19h8M14 5l-4 14" /></I>
export const Strike = (p: P) => <I {...p}><path d="M5 12h14M16.5 7.5C15.5 6 13.9 5 12 5c-2.500 0-4.200 1.300-4.200 3.200 0 1.500 1 2.400 2.700 3M8 16.500C8.900 18 10.300 19 12.300 19c2.600 0 4.200-1.300 4.200-3.100 0-.7-.2-1.200-.6-1.700" /></I>
export const Heading = (p: P) => <I {...p}><path d="M6 5v14M18 5v14M6 12h12" /></I>
export const ListUl = (p: P) => <I {...p}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.500" cy="6" r="1" /><circle cx="4.500" cy="12" r="1" /><circle cx="4.500" cy="18" r="1" /></I>
export const ListOl = (p: P) => <I {...p}><path d="M10 6h10M10 12h10M10 18h10M4 5l1.500-1v5M3.500 13.500c.5-1 2.500-1 2.500.3 0 1-1.500 1.500-2.500 2.700H6M3.500 19.500c1 .5 2.500.2 2.500-.7 0-.7-.7-1-1.500-1 .8 0 1.300-.3 1.300-.9 0-.9-1.700-1.200-2.300-.5" /></I>
export const Task = (p: P) => <I {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8.500 12l2.500 2.500 4.500-5" /></I>
export const Quote = (p: P) => <I {...p}><path d="M5 17V11a4 4 0 0 1 4-4M14 17V11a4 4 0 0 1 4-4M5 17h4v-4H5zM14 17h4v-4h-4z" /></I>
export const LinkIcon = (p: P) => <I {...p}><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" /></I>
export const Code = (p: P) => <I {...p}><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 5l-4 14" /></I>
export const Rule = (p: P) => <I {...p}><path d="M4 12h16M8 7h8M8 17h8" strokeDasharray="0.1 0" /></I>
export const More = (p: P) => <I {...p}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></I>
export const Download = (p: P) => <I {...p}><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></I>
export const Sparkle = (p: P) => <I {...p}><path d="M12 3l1.8 5.2L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800zM19 16l.8 2.200L22 19l-2.200.8L19 22l-.8-2.200L16 19l2.200-.8z" /></I>
export const Send = (p: P) => <I {...p}><path d="M4 12l16-8-6 16-3-7z" /></I>
export const Check = (p: P) => <I {...p}><path d="M5 12l5 5 9-10" /></I>
export const Refresh = (p: P) => <I {...p}><path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4" /></I>
export const Undo = (p: P) => <I {...p}><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></I>
export const Chat = (p: P) => <I {...p}><path d="M4 5h16v11H9l-5 4z" /></I>
export const Upload = (p: P) => <I {...p}><path d="M12 16V5M7 9l5-5 5 5M5 20h14" /></I>

/** One small glyph per section kind, used on cards. */
export const KindIcon = ({ kind, ...p }: { kind: SectionKind } & P) => {
  switch (kind) {
    case 'details': return <I {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M14 10h4M14 14h4M6 16c.5-1.5 1.5-2 3-2s2.500.5 3 2" /></I>
    case 'text': return <I {...p}><path d="M5 6h14M5 10h14M5 14h14M5 18h9" /></I>
    case 'entries': return <I {...p}><path d="M7 4v16" /><circle cx="7" cy="7" r="1.6" /><circle cx="7" cy="14" r="1.6" /><path d="M12 7h8M12 14h8" /></I>
    case 'levels': return <I {...p}><path d="M4 8h16M4 16h16" /><path d="M4 8h10M4 16h6" strokeWidth="3" /></I>
    case 'links': return <I {...p}><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" /></I>
  }
}
export const Target = (p: P) => <I {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.6" /></I>
export const Copy = (p: P) => <I {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></I>
export const Edit = (p: P) => <I {...p}><path d="M4 20h4L19 9l-4-4L4 16zM13.500 6.500l4 4" /></I>
export const Layout = (p: P) => <I {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M9 11h12" /></I>
