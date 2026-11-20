import { BulletsEditor, CheckField, IconPicker, LevelPicker, ListEditor, MonthField, RichTextField, TextField } from '../components/fields'
import { Back } from '../components/icons'
import { getLayout } from '../layouts/registry'
import { KIND_LABEL, emptyEntry, uid, type Entry, type IconId, type Section } from '../model/types'
import { entryDates } from '../model/dates'
import { useResume } from '../state/ResumeContext'

function EntryForm({ en, up, section }: { en: Entry; up: (p: Partial<Entry>) => void; section: string }) {
  const ctx = { role: en.title, organisation: en.organisation, section }
  return (
    <>
      <div className="grid2">
        <TextField label="Title / role" value={en.title} onChange={(v) => up({ title: v })} />
        <TextField label="Organisation" value={en.organisation} onChange={(v) => up({ organisation: v })} />
      </div>
      <TextField label="Location" value={en.location} onChange={(v) => up({ location: v })} placeholder="City, Country" />
      <div className="grid2">
        <MonthField label="Start" value={en.start} onChange={(v) => up({ start: v })} />
        <MonthField label="End" value={en.end} onChange={(v) => up({ end: v })} disabled={en.current} error={!en.current && en.start && en.end && /^\d{4}-\d{2}$/.test(en.start) && /^\d{4}-\d{2}$/.test(en.end) && en.end < en.start ? 'Ends before it starts' : undefined} />
      </div>
      <CheckField label="Ongoing (shows “Present”)" checked={en.current} onChange={(v) => up({ current: v })} />
      <TextField label="Highlight line" hint="Optional bold line, e.g. a grade or qualification level" value={en.note} onChange={(v) => up({ note: v })} improve={{ kind: 'note', context: ctx }} />
      <RichTextField label="Description" value={en.description} onChange={(v) => up({ description: v })} improve={{ kind: 'description', context: ctx }} />
      <BulletsEditor value={en.bullets} onChange={(v) => up({ bullets: v })} improveContext={ctx} />
    </>
  )
}

export function SectionEditor({ sec, onBack, goInfo }: { sec: Section; onBack: () => void; goInfo: () => void }) {
  const { patchSection, resume } = useResume()
  const showIcons = !!getLayout(resume.layoutId).icons
  const up = (patch: Partial<Section>) => patchSection(sec.id, patch)

  return (
    <div className="section-editor">
      <button type="button" className="back" onClick={onBack}><Back /> All sections</button>
      <div className="form">
        <TextField label="Section title" value={sec.title} onChange={(v) => up({ title: v })} />
        {showIcons && sec.zone !== 'header' && <IconPicker label="Icon" value={sec.icon} onChange={(v: IconId) => up({ icon: v })} />}
        {sec.kind !== 'text' && sec.kind !== 'details' && KIND_LABEL[sec.kind].toLowerCase() !== sec.title.trim().toLowerCase() && <p className="kind-tag">{KIND_LABEL[sec.kind]}</p>}

        {sec.kind === 'details' && (
          <p className="form-note">
            This block shows your address and personal details, which are the same on all your CVs. Edit them in <button type="button" className="link" onClick={goInfo}>Personal info</button>.
          </p>
        )}

        {sec.kind === 'text' && <RichTextField label="Content" rows={sec.zone === 'side' ? 6 : 8} value={sec.text} onChange={(v) => up({ text: v } as Partial<Section>)} improve={{ kind: sec.icon === 'user' ? 'summary' : 'text', context: { section: sec.title } }} />}

        {sec.kind === 'entries' && (
          <>
            <CheckField label="Format titles as “Role at Organisation”" checked={sec.job} onChange={(v) => up({ job: v } as Partial<Section>)} />
            <ListEditor
              items={sec.items}
              onChange={(items) => up({ items } as Partial<Section>)}
              create={emptyEntry}
              addLabel="Add entry"
              itemName="entry"
              summary={(e) => [e.title, e.organisation].filter(Boolean).join(' · ')}
              detail={(e) => entryDates(e)}
              render={(en, u) => <EntryForm en={en} up={u} section={sec.title} />}
            />
          </>
        )}

        {sec.kind === 'levels' && (
          <ListEditor
            inline
            items={sec.items}
            onChange={(items) => up({ items } as Partial<Section>)}
            create={() => ({ id: uid(), name: '', level: 3 })}
            addLabel="Add item"
            itemName="item"
            summary={(s) => s.name}
            render={(s, u) => (
              <div className="level-row">
                <TextField label="Name" value={s.name} onChange={(v) => u({ name: v })} />
                <LevelPicker value={s.level} onChange={(v) => u({ level: v })} label={`Level of ${s.name || 'item'}`} />
              </div>
            )}
          />
        )}

        {sec.kind === 'links' && (
          <ListEditor
            inline
            items={sec.items}
            onChange={(items) => up({ items } as Partial<Section>)}
            create={() => ({ id: uid(), label: '', url: '' })}
            addLabel="Add link"
            itemName="link"
            summary={(l) => l.label}
            render={(l, u) => (
              <div className="grid2">
                <TextField label="Label" value={l.label} onChange={(v) => u({ label: v })} placeholder="LinkedIn" />
                <TextField label="URL" type="url" value={l.url} onChange={(v) => u({ url: v })} placeholder="https://…" inputMode="url" error={l.url.trim() && !/^(https?:\/\/|mailto:)\S+\.\S+|^mailto:/i.test(l.url.trim()) ? 'Start with https:// (or mailto:)' : undefined} />
              </div>
            )}
          />
        )}
      </div>
    </div>
  )
}
