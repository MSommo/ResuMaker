import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './campus.css'

/** PLACEHOLDER: replaced by the real Campus layout. */
export function CampusLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-campus" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
