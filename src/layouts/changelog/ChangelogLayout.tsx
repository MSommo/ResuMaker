import { zoneSections } from '../../model/sections'
import type { Resume } from '../../model/types'
import { Paginated } from '../Paginated'
import './changelog.css'

/** PLACEHOLDER: replaced by the real Changelog layout. */
export function ChangelogLayout({ resume: r }: { resume: Resume }) {
  void zoneSections
  return <Paginated className="lx-changelog" header={<header>{r.basics.firstName} {r.basics.lastName}</header>} side={[]} main={[]} />
}
