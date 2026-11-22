import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './billboard.css'

/** PLACEHOLDER: replaced by the real Billboard layout. */
export function BillboardLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-billboard" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
