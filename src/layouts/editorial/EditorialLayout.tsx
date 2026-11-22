import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './editorial.css'

/** PLACEHOLDER: replaced by the real Editorial layout. */
export function EditorialLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-editorial" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
