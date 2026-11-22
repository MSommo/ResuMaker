import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './document.css'

/** PLACEHOLDER: replaced by the real JSON Document layout. */
export function DocumentLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-document" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
