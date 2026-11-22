import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './chambers.css'

/** PLACEHOLDER: replaced by the real Chambers layout. */
export function ChambersLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-chambers" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
