import { BulletsEditor, CheckField, LevelPicker, ListEditor, MonthField, RichTextField, SelectField, TextField } from '../components/fields'
import { Back } from '../components/icons'
import { ICON_LABEL, KIND_LABEL, emptyEntry, uid, type Entry, type IconId, type Section } from '../model/types'
import { entryDates } from '../model/dates'
import { useResume } from '../state/ResumeContext'

function EntryForm({ en, up }: { en: Entry; up: (p: Partial<Entry>) => void }) {
  return (
    <>
      <div className="grid2">
        <TextField label="Title / role" value={en.title} onChange={(v) => up({ title: v })} />
        <TextField label="Organisation" value={en.organisation} onChange={(v) => up({ organisation: v })} />
      </div>
      <TextField label="Location" value={en.location} onChange={(v) => up({ location: v })} placeholder="City, Country" />
      <div className="grid2">
        <MonthField label="Start" value={en.start} onChange={(v) => up({ start: v })} />
        <MonthField label="End" value={en.end} onChange={(v) => up({ end: v })} disabled={en.current} />
      </div>
      <CheckField label="Ongoing (shows “Present”)" checked={en.current} onChange={(v) => up({ current: v })} />
      <TextField label="Highlight line" hint="Optional bold line, e.g. a grade or qualification level" value={en.note} onChange={(v) => up({ note: v })} />
      <RichTextField label="Description" value={en.description} onChange={(v) => up({ description: v })} />
      <BulletsEditor value={en.bullets} onChange={(v) => up({ bullets: v })} />
    </>
  )
}

export function SectionEditor({ sec, onBack, goInfo }: { sec: Section; onBack: () => void; goInfo: () => void }) {
  const { patchSection } = useResume()
  const up = (patch: Partial<Section>) => patchSection(sec.id, patch)

  return (
    <div className="section-editor">
      <button type="button" className="back" onClick={onBack}><Back /> All sections</button>
      <div className="form">
        <div className="grid2">
          <TextField label="Section title" value={sec.title} onChange={(v) => up({ title: v })} />
          <SelectField label="Icon" hint="For layouts that show one" value={sec.icon} onChange={(v) => up({ icon: v as IconId })} options={Object.entries(ICON_LABEL).map(([value, label]) => ({ value, label }))} />
        </div>
        <p className="kind-tag">{KIND_LABEL[sec.kind]}</p>

        {sec.kind === 'details' && (
          <p className="form-note">
            This block shows your personal details. Edit them under <button type="button" className="link" onClick={goInfo}>Personal info</button>.
          </p>
        )}

        {sec.kind === 'text' && <RichTextField label="Text" rows={sec.zone === 'side' ? 6 : 8} value={sec.text} onChange={(v) => up({ text: v } as Partial<Section>)} />}

        {sec.kind === 'entries' && (
          <>
            <CheckField label="Format titles as “Role at Organisation”" checked={sec.job} onChange={(v) => up({ job: v } as Partial<Section>)} />
            <ListEditor
              items={sec.items}
              onChange={(items) => up({ items } as Partial<Section>)}
              create={emptyEntry}
              addLabel="Add entry"
              summary={(e) => [e.title, e.organisation].filter(Boolean).join(' · ') + (entryDates(e) ? `  (${entryDates(e)})` : '')}
              render={(en, u) => <EntryForm en={en} up={u} />}
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
            summary={(l) => l.label}
            render={(l, u) => (
              <div className="grid2">
                <TextField label="Label" value={l.label} onChange={(v) => u({ label: v })} placeholder="LinkedIn" />
                <TextField label="URL" type="url" value={l.url} onChange={(v) => u({ url: v })} placeholder="https://…" inputMode="url" />
              </div>
            )}
          />
        )}
      </div>
    </div>
  )
}
