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
export const More = (p: P) => <I {...p}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></I>
export const Download = (p: P) => <I {...p}><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></I>
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
