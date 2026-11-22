import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './riso.css'

/** PLACEHOLDER: replaced by the real Risograph layout. */
export function RisoLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-riso" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
