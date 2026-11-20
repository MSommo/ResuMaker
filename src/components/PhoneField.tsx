import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { composePhone, dialLabel, dialOf, flagOf, normalizeIntl, parsePhone, searchCountries } from '../model/phone'
import { Popover } from './Popover'
import { Chevron } from './icons'

function CountryList({ selected, onPick }: { selected: string | null; onPick: (iso: string) => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const hits = useMemo(() => searchCountries(q), [q])
  const listRef = useRef<HTMLUListElement>(null)
  const id = useId()
  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <div className="country-list">
      <input
        autoFocus
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search country or code (+39)"
        aria-label="Search countries"
        role="combobox"
        aria-expanded
        aria-controls={id}
        aria-activedescendant={hits[active] ? `${id}-${hits[active].code}` : undefined}
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, hits.length - 1)))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
          else if (e.key === 'Enter') {
            e.preventDefault()
            if (hits[active]) onPick(hits[active].code)
          }
        }}
      />
      <ul id={id} ref={listRef} role="listbox" aria-label="Countries">
        {hits.map((c, i) => (
          <li key={c.code} id={`${id}-${c.code}`} role="option" aria-selected={c.code === selected} className={i === active ? 'active' : ''} onPointerMove={() => setActive(i)} onClick={() => onPick(c.code)}>
            <span className="flag" aria-hidden>{flagOf(c.code)}</span>
            <span className="cname">{c.name}</span>
            <span className="cdial">{dialLabel(c.dial)}</span>
          </li>
        ))}
        {!hits.length && <li className="none">No country matches “{q}”.</li>}
      </ul>
    </div>
  )
}

/**
 * Phone number with a searchable country picker (name or calling code, with flag). Stored as plain text like "+39 333 1234567".
 * Typing or pasting "+39…" or "0039…" recognises the country as soon as the code is complete.
 */
export function PhoneField({ label, hint, className = '', value, onChange, defaultCountry = '' }: {
  label: string
  hint?: string
  className?: string
  value: string
  onChange: (v: string) => void
  /** Preselected when the number is empty, e.g. the person's country of residence. */
  defaultCountry?: string
}) {
  const id = useId()
  // The country the user picked (or the default). It only matters while it agrees with the number's calling code.
  const [picked, setPicked] = useState<string | null>(defaultCountry && dialOf(defaultCountry) ? defaultCountry : null)
  useEffect(() => {
    if (!value && defaultCountry && dialOf(defaultCountry)) setPicked(defaultCountry)
  }, [defaultCountry, value])

  const { iso, national } = parsePhone(value, picked)

  const edit = (text: string) => {
    const t = normalizeIntl(text)
    if (t.trimStart().startsWith('+')) {
      // A full international number: let the country be recognised from it.
      setPicked(null)
      onChange(t)
    } else {
      if (iso) setPicked(iso) // keep the flag even if the box is emptied
      onChange(composePhone(iso, t) || (iso ? '' : t))
    }
  }
  const pick = (code: string) => {
    setPicked(code)
    onChange(composePhone(code, national))
  }

  return (
    <div className={`field ${className}`}>
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
      </div>
      <div className="phone">
        <Popover
          label={iso ? `Country: ${iso}, ${dialLabel(dialOf(iso))}. Change country` : 'Choose country'}
          triggerClassName="phone-country"
          trigger={
            <>
              <span className="flag" aria-hidden>{iso ? flagOf(iso) : '🌐'}</span>
              <span className="pdial">{iso ? dialLabel(dialOf(iso)) : '+'}</span>
              <Chevron className="pchev" />
            </>
          }
        >
          {(close) => (
            <CountryList
              selected={iso}
              onPick={(c) => {
                pick(c)
                close()
                requestAnimationFrame(() => document.getElementById(id)?.focus())
              }}
            />
          )}
        </Popover>
        <input id={id} type="tel" inputMode="tel" autoComplete="tel-national" value={national} onChange={(e) => edit(e.target.value)} placeholder={iso ? '333 1234567' : '+44 7000 000000'} />
      </div>
      {hint && <small>{hint}</small>}
    </div>
  )
}
