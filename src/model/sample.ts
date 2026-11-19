import { TEMPLATES } from './templates'
import { uid, type Basics, type Entry, type Leveled, type Resume, type Section } from './types'

const e = (p: Partial<Entry>): Entry => ({
  id: uid(), title: '', organisation: '', location: '', start: '', end: '', current: false, note: '', description: '', bullets: [], ...p,
})
const lv = (name: string, level: number): Leveled => ({ id: uid(), name, level })

/** Default placement of the built-in components. */
const PLACEMENT: Record<string, string> = {
  details: 'side', skills: 'side', languages: 'side', links: 'side', hobbies: 'side',
  profile: 'main', employment: 'main', education: 'main', courses: 'main', achievements: 'main',
}

function build(layoutId: string, basics: Basics, content: Record<string, Partial<Section>>): Resume {
  const sections = Object.keys(PLACEMENT).map((tid) => {
    const t = TEMPLATES.find((x) => x.id === tid)!
    return { ...t.make(), ...content[tid], zone: PLACEMENT[tid] } as Section
  })
  return { layoutId, basics, sections }
}

const emptyBasics = (): Basics => ({
  firstName: '', lastName: '', headline: '', email: '', phone: '',
  address: { street: '', city: '', postcode: '', country: '' }, birthDate: '', birthPlace: '', nationality: '',
})

export const blankResume = (layoutId = 'sidebar'): Resume => build(layoutId, emptyBasics(), {})

export const sampleResume = (layoutId = 'sidebar'): Resume =>
  build(
    layoutId,
    {
      firstName: 'Jane', lastName: 'Doe', headline: 'Senior Software Engineer', email: 'jane.doe@example.com', phone: '+44 7000 000000',
      address: { street: '1 Example Street', city: 'London', postcode: 'EC1A 1AA', country: 'GB' },
      birthDate: '1990-01-01', birthPlace: 'London, UK', nationality: 'British',
    },
    {
      profile: { text: 'Experienced engineer with a track record of delivering reliable products end to end. Strong background in TypeScript, cloud infrastructure and mentoring teams.' },
      employment: {
        items: [
          e({
            title: 'Senior Software Engineer', organisation: 'Acme Corp', location: 'London, UK', start: '2022-01', current: true,
            description: 'Lead engineer on the platform team.',
            bullets: ['# Architecture', 'Designed an event-driven backend serving **2M requests** per day.', '# Leadership', 'Coached four engineers through promotion.'],
          }),
          e({
            title: 'Software Engineer', organisation: 'Globex', location: 'Bristol, UK', start: '2018-06', end: '2021-12',
            bullets: ['Built and maintained customer-facing React applications.', 'Introduced automated testing, cutting regressions by 40%.'],
          }),
        ],
      } as Partial<Section>,
      courses: { items: [e({ title: 'AWS Certified Developer', organisation: 'AWS', start: '2023-05', current: true })] } as Partial<Section>,
      education: {
        items: [e({ title: 'BSc Computer Science', organisation: 'University of Example', location: 'Bristol, UK', start: '2014-09', end: '2018-06', note: 'First Class Honours', description: 'Focus on distributed systems and software engineering.' })],
      } as Partial<Section>,
      achievements: { items: [e({ title: 'Engineering Excellence Award', location: 'London, UK', start: '2023-10', description: 'Recognised for outstanding contribution to the platform team.' })] } as Partial<Section>,
      skills: { items: [lv('TypeScript', 5), lv('React', 4), lv('Node.js', 4), lv('SQL', 3)] } as Partial<Section>,
      languages: { items: [lv('English', 5), lv('French', 3)] } as Partial<Section>,
      links: { items: [{ id: uid(), label: 'LinkedIn', url: 'https://linkedin.com/in/example' }, { id: uid(), label: 'GitHub', url: 'https://github.com/example' }] } as Partial<Section>,
      hobbies: { text: 'Chess and tactical puzzles.\n\nBuilding side projects.' } as Partial<Section>,
    },
  )
