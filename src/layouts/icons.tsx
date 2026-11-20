import type { ReactNode } from 'react'
import type { IconId } from '../model/types'

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    {children}
  </svg>
)

/** Section icon glyphs: drawn by layouts that show icons, and shown in the editor's icon picker. */
export const SECTION_ICONS: Record<IconId, ReactNode> = {
  none: (
    <Icon>
      <circle cx="12" cy="12" r="4" />
    </Icon>
  ),
  bookmark: (
    <Icon>
      <path d="M6 2h12a1 1 0 0 1 1 1v19l-7-4-7 4V3a1 1 0 0 1 1-1z" />
    </Icon>
  ),
  user: (
    <Icon>
      <circle cx="12" cy="7.5" r="4.5" />
      <path d="M3 22c0-5 4-8 9-8s9 3 9 8z" />
    </Icon>
  ),
  briefcase: (
    <Icon>
      <path d="M9 3h6a2 2 0 0 1 2 2v2h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4V5a2 2 0 0 1 2-2zm0 2v2h6V5z" />
    </Icon>
  ),
  badge: (
    <Icon>
      <path d="M12 1l3 2 3.6-.2 1 3.5 3 2-1.2 3.4 1.2 3.4-3 2-1 3.5L15 21l-3 2-3-2-3.6.2-1-3.5-3-2L3.6 12 2.4 8.6l3-2 1-3.5L9 3z" />
      <path d="M7.5 12.2l3 3 6-6.2" fill="none" stroke="#fff" strokeWidth="2.2" />
    </Icon>
  ),
  cap: (
    <Icon>
      <path d="M12 3L1 9l11 6 9-4.9V17h2V9zM5 13.2V17c0 1.7 3.1 3.5 7 3.5s7-1.8 7-3.5v-3.8l-7 3.8z" />
    </Icon>
  ),
  star: (
    <Icon>
      <path d="M12 1.5l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6l-6.4 3.5 1.4-7.1-5.3-5 7.2-.9z" />
    </Icon>
  ),
}
