import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './concierge.css'

/** PLACEHOLDER: replaced by the real Concierge layout. */
export function ConciergeLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-concierge" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
