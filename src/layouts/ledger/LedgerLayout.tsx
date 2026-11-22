import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './ledger.css'

/** PLACEHOLDER: replaced by the real Data Ledger layout. */
export function LedgerLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-ledger" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
