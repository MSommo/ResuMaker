import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './exhibit.css'

/** PLACEHOLDER: replaced by the real Exhibit layout. */
export function ExhibitLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-exhibit" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
