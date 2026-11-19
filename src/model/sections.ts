import type { Resume } from './types'

export const zoneSections = (r: Resume, zone: string) => r.sections.filter((s) => s.zone === zone)
export const stashed = (r: Resume) => r.sections.filter((s) => s.zone === null)
