import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './roadmap.css'

/** PLACEHOLDER: replaced by the real Roadmap layout. */
export function RoadmapLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-roadmap" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
