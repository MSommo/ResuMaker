import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './clinic.css'

/** PLACEHOLDER: replaced by the real Clinic layout. */
export function ClinicLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-clinic" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
