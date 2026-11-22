import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './datasheet.css'

/** PLACEHOLDER: replaced by the real Datasheet layout. */
export function DatasheetLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-datasheet" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
