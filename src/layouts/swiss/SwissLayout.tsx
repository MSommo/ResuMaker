import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './swiss.css'

/** PLACEHOLDER: replaced by the real Swiss Grid layout. */
export function SwissLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-swiss" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
