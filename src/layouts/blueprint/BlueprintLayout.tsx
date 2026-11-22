import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './blueprint.css'

/** PLACEHOLDER: replaced by the real Blueprint layout. */
export function BlueprintLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-blueprint" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
