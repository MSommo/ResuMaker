import { useParams, useSearchParams } from 'react-router-dom'
import { getLayout } from '../layouts/registry'
import { blankResume, sampleResume } from '../model/sample'
import { uid, type Resume, type Section } from '../model/types'

/** Dev only (`/lab/:layoutId?data=sample|empty|long`): one layout on sample data, no sign-in, to look at while building it. */
function longResume(layoutId: string): Resume {
  const r = sampleResume(layoutId)
  const again = <T extends { id: string }>(items: T[], n: number) => Array.from({ length: n }, () => items.map((i) => ({ ...i, id: uid() }))).flat()
  const sections = r.sections.map((s): Section => {
    if (s.kind === 'entries') return { ...s, items: again(s.items, s.job ? 5 : 3) }
    if (s.kind === 'levels') return { ...s, items: again(s.items, 3) }
    if (s.kind === 'links') return { ...s, items: again(s.items, 2) }
    if (s.kind === 'text') return { ...s, text: `${s.text}\n\n${s.text}\n\n${s.text}` }
    return s
  })
  return { ...r, sections }
}

export default function Lab() {
  const { layoutId = 'sidebar' } = useParams()
  const [q] = useSearchParams()
  const layout = getLayout(layoutId)
  const data = q.get('data')
  const resume = data === 'empty' ? blankResume(layout.id) : data === 'long' ? longResume(layout.id) : sampleResume(layout.id)
  const Layout = layout.Component
  return <Layout resume={resume} />
}
