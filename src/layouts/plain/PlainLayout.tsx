import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './plain.css'

/** PLACEHOLDER: replaced by the real Plain layout. */
export function PlainLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-plain" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
