import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './terminal.css'

/** PLACEHOLDER: replaced by the real Terminal layout. */
export function TerminalLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-terminal" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
