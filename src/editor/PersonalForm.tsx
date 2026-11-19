import { CountryField, NationalityField, TextField } from '../components/fields'
import { useResume } from '../state/ResumeContext'

export function PersonalForm() {
  const { resume, setBasics } = useResume()
  const b = resume.basics
  const setAddr = (patch: Partial<typeof b.address>) => setBasics({ address: { ...b.address, ...patch } })
  return (
    <div className="form">
      <fieldset>
        <legend>Name</legend>
        <div className="grid2">
          <TextField label="First name" value={b.firstName} onChange={(v) => setBasics({ firstName: v })} autoComplete="given-name" />
          <TextField label="Last name" value={b.lastName} onChange={(v) => setBasics({ lastName: v })} autoComplete="family-name" />
        </div>
        <TextField label="Headline" hint="Shown under your name, e.g. “Senior Software Engineer”" value={b.headline} onChange={(v) => setBasics({ headline: v })} />
      </fieldset>

      <fieldset>
        <legend>Contact</legend>
        <div className="grid2">
          <TextField label="Email" type="email" value={b.email} onChange={(v) => setBasics({ email: v })} autoComplete="email" inputMode="email" />
          <TextField label="Phone" type="tel" value={b.phone} onChange={(v) => setBasics({ phone: v })} autoComplete="tel" inputMode="tel" placeholder="+44 7000 000000" />
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
          <TextField label="Date of birth" type="date" value={b.birthDate} onChange={(v) => setBasics({ birthDate: v })} autoComplete="bday" />
          <TextField label="Place of birth" value={b.birthPlace} onChange={(v) => setBasics({ birthPlace: v })} placeholder="City, Country" />
        </div>
        <NationalityField label="Nationality" value={b.nationality} onChange={(v) => setBasics({ nationality: v })} />
      </fieldset>
      <p className="form-note">These appear in the header and in any <b>Personal details</b> component you place in the CV.</p>
    </div>
  )
}
