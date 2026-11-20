import { CountryField, NationalityField, TextField } from '../components/fields'
import { PhoneField } from '../components/PhoneField'
import type { PersonalDetails } from '../model/types'

/** The persona's details form. Used on the persona pages and inside the editor's "Personal info" tab. */
export function PersonalFields({ value: b, onChange }: { value: PersonalDetails; onChange: (patch: Partial<PersonalDetails>) => void }) {
  const setAddr = (patch: Partial<PersonalDetails['address']>) => onChange({ address: { ...b.address, ...patch } })
  return (
    <>
      <fieldset>
        <legend>Name</legend>
        <div className="grid2">
          <TextField label="First name" value={b.firstName} onChange={(v) => onChange({ firstName: v })} autoComplete="given-name" required />
          <TextField label="Last name" value={b.lastName} onChange={(v) => onChange({ lastName: v })} autoComplete="family-name" />
        </div>
      </fieldset>

      <fieldset>
        <legend>Contact</legend>
        <div>
          <TextField label="Email" type="email" value={b.email} onChange={(v) => onChange({ email: v })} autoComplete="email" inputMode="email" />
          <PhoneField label="Phone" value={b.phone} onChange={(v) => onChange({ phone: v })} defaultCountry={b.address.country} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Address</legend>
        <TextField label="Street" value={b.address.street} onChange={(v) => setAddr({ street: v })} autoComplete="address-line1" />
        <div className="grid2">
          <TextField label="City" value={b.address.city} onChange={(v) => setAddr({ city: v })} autoComplete="address-level2" />
          <TextField label="Postcode" value={b.address.postcode} onChange={(v) => setAddr({ postcode: v })} autoComplete="postal-code" />
        </div>
        <CountryField label="Country" value={b.address.country} onChange={(v) => setAddr({ country: v })} />
      </fieldset>

      <fieldset>
        <legend>Personal</legend>
        <div className="grid2">
          <TextField label="Date of birth" type="date" value={b.birthDate} onChange={(v) => onChange({ birthDate: v })} autoComplete="bday" />
          <TextField label="Place of birth" value={b.birthPlace} onChange={(v) => onChange({ birthPlace: v })} placeholder="City, Country" />
        </div>
        <NationalityField label="Nationality" value={b.nationality} onChange={(v) => onChange({ nationality: v })} />
      </fieldset>
    </>
  )
}
