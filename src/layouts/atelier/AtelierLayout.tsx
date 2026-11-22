import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './atelier.css'

/** PLACEHOLDER: replaced by the real Atelier layout. */
export function AtelierLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-atelier" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
