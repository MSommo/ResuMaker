import { countries } from './countries'

/**
 * Calling codes by ISO country. Codes are prefix-free except the shared "+1" (North America) and "+7" (Russia/Kazakhstan),
 * so a typed number can be matched to its country as soon as the code is complete. Caribbean NANP countries use "1" + area code.
 */
const DIAL: Record<string, string> = {
  AD: '376', AE: '971', AF: '93', AG: '1268', AI: '1264', AL: '355', AM: '374', AO: '244', AR: '54', AS: '1684', AT: '43', AU: '61', AW: '297',
  AZ: '994', BA: '387', BB: '1246', BD: '880', BE: '32', BF: '226', BG: '359', BH: '973', BI: '257', BJ: '229', BL: '590', BM: '1441', BN: '673',
  BO: '591', BR: '55', BS: '1242', BT: '975', BW: '267', BY: '375', BZ: '501', CA: '1', CD: '243', CF: '236', CG: '242', CH: '41', CI: '225',
  CK: '682', CL: '56', CM: '237', CN: '86', CO: '57', CR: '506', CU: '53', CV: '238', CW: '599', CY: '357', CZ: '420', DE: '49', DJ: '253',
  DK: '45', DM: '1767', DO: '1809', DZ: '213', EC: '593', EE: '372', EG: '20', ER: '291', ES: '34', ET: '251', FI: '358', FJ: '679', FK: '500',
  FM: '691', FO: '298', FR: '33', GA: '241', GB: '44', GD: '1473', GE: '995', GF: '594', GH: '233', GI: '350', GL: '299', GM: '220', GN: '224',
  GP: '590', GQ: '240', GR: '30', GT: '502', GU: '1671', GW: '245', GY: '592', HK: '852', HN: '504', HR: '385', HT: '509', HU: '36', ID: '62',
  IE: '353', IL: '972', IN: '91', IQ: '964', IR: '98', IS: '354', IT: '39', JM: '1876', JO: '962', JP: '81', KE: '254', KG: '996', KH: '855',
  KI: '686', KM: '269', KN: '1869', KP: '850', KR: '82', KW: '965', KY: '1345', KZ: '7', LA: '856', LB: '961', LC: '1758', LI: '423', LK: '94',
  LR: '231', LS: '266', LT: '370', LU: '352', LV: '371', LY: '218', MA: '212', MC: '377', MD: '373', ME: '382', MG: '261', MH: '692', MK: '389',
  ML: '223', MM: '95', MN: '976', MO: '853', MP: '1670', MQ: '596', MR: '222', MS: '1664', MT: '356', MU: '230', MV: '960', MW: '265', MX: '52',
  MY: '60', MZ: '258', NA: '264', NC: '687', NE: '227', NF: '672', NG: '234', NI: '505', NL: '31', NO: '47', NP: '977', NR: '674', NU: '683',
  NZ: '64', OM: '968', PA: '507', PE: '51', PF: '689', PG: '675', PH: '63', PK: '92', PL: '48', PM: '508', PR: '1787', PS: '970', PT: '351',
  PW: '680', PY: '595', QA: '974', RE: '262', RO: '40', RS: '381', RU: '7', RW: '250', SA: '966', SB: '677', SC: '248', SD: '249', SE: '46',
  SG: '65', SH: '290', SI: '386', SK: '421', SL: '232', SM: '378', SN: '221', SO: '252', SR: '597', SS: '211', ST: '239', SV: '503', SX: '1721',
  SY: '963', SZ: '268', TC: '1649', TD: '235', TG: '228', TH: '66', TJ: '992', TK: '690', TL: '670', TM: '993', TN: '216', TO: '676', TR: '90',
  TT: '1868', TV: '688', TW: '886', TZ: '255', UA: '380', UG: '256', US: '1', UY: '598', UZ: '998', VC: '1784', VE: '58', VG: '1284', VI: '1340',
  VN: '84', VU: '678', WF: '681', WS: '685', XK: '383', YE: '967', ZA: '27', ZM: '260', ZW: '263',
}

// Canadian area codes (they share +1 with the US) and a few more NANP codes, so "+1 416…" is recognised as Canada.
const CA_AREA = '204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 403 416 418 431 437 438 450 468 474 506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 902 905'
const EXTRA: [string, string][] = [
  ...CA_AREA.split(' ').map((a): [string, string] => ['1' + a, 'CA']),
  ['1829', 'DO'], ['1849', 'DO'], ['1939', 'PR'], ['76', 'KZ'], ['77', 'KZ'],
]

/** Longest code first, so "+1 242" (Bahamas) wins over "+1". */
const DETECT: [string, string][] = [
  ...Object.entries(DIAL).filter(([iso]) => iso !== 'KZ' && iso !== 'CA').map(([iso, d]): [string, string] => [d, iso]),
  ...EXTRA,
].sort((a, b) => b[0].length - a[0].length)

export interface PhoneCountry {
  code: string
  name: string
  dial: string
}

let list: PhoneCountry[] | null = null
/** Countries that have a calling code, by name. */
export function phoneCountries(): PhoneCountry[] {
  return (list ??= countries().filter((c) => DIAL[c.code]).map((c) => ({ ...c, dial: DIAL[c.code] })))
}

export const dialOf = (iso: string | null | undefined) => (iso ? DIAL[iso] ?? '' : '')

/** "+39", or "+1 242" for the Caribbean codes that are written with an area code. */
export const dialLabel = (dial: string) => (dial.length > 1 && dial.startsWith('1') ? `+1 ${dial.slice(1)}` : `+${dial}`)

/** 🇮🇹 for "IT". Built from the code, so no flag data is shipped. */
export const flagOf = (iso: string) => (/^[A-Z]{2}$/.test(iso) ? String.fromCodePoint(...[...iso].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '')

/** The country a number belongs to, from its digits (after "+" or "00"). */
export function detectCountry(digits: string): string | null {
  for (const [dial, iso] of DETECT) if (digits.startsWith(dial)) return iso
  return null
}

/** Removes the leading `dial` digits from `raw`, tolerating spaces, dashes and brackets between them. */
function stripDial(raw: string, dial: string): string {
  let i = 0
  let k = 0
  while (i < raw.length && k < dial.length) {
    if (raw[i] === dial[k]) k++
    else if (/\d/.test(raw[i])) break
    i++
  }
  return raw.slice(i).replace(/^[\s\-.()]+/, '')
}

/** Rewrites a leading "00" as "+". */
export const normalizeIntl = (s: string) => (/^\s*00(?!0)/.test(s) ? s.replace(/^\s*00/, '+') : s)

export interface ParsedPhone {
  /** Country of the number, or null when the value has no (complete) international prefix. */
  iso: string | null
  /** The part after the calling code (or the whole text when there is no country). */
  national: string
}

/**
 * Splits a stored phone value. `preferred` (the country the user picked, or a default) wins when its calling code matches,
 * so picking Canada keeps "+1 212…" in Canada instead of snapping back to the US.
 */
export function parsePhone(value: string, preferred: string | null = null): ParsedPhone {
  const v = normalizeIntl(value).replace(/^\s+/, '') // not trimmed at the end: a trailing space is the user typing the next group
  if (!v.startsWith('+')) return { iso: v.trim() ? null : preferred, national: value }
  const digits = v.replace(/\D/g, '')
  const pd = dialOf(preferred)
  const iso = preferred && pd && digits.startsWith(pd) ? preferred : detectCountry(digits)
  if (!iso) return { iso: null, national: value }
  return { iso, national: stripDial(v, dialOf(iso)) }
}

/** Joins a country and a national number into the stored form: "+39 333 1234567". Empty when there is no number. */
export function composePhone(iso: string | null, national: string): string {
  const n = national.replace(/^\s+/, '') // keep trailing spaces: they are the user typing the next group
  if (!n.trim()) return ''
  return iso ? `${dialLabel(dialOf(iso))} ${n}` : n
}

/** Countries matching a search: by name, or by calling code ("+39", "39", "1242"). */
export function searchCountries(query: string): PhoneCountry[] {
  const q = query.trim().toLowerCase()
  const all = phoneCountries()
  if (!q) return all
  const digits = q.replace(/\D/g, '')
  const byCode = /^\+?[\d\s]+$/.test(q) && digits
  const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const nq = plain(q)
  const hits = all.filter((c) => (byCode ? c.dial.startsWith(digits) : plain(c.name).includes(nq) || c.code.toLowerCase() === q))
  // Names that start with the query first, then the rest.
  return byCode ? hits : hits.sort((a, b) => Number(plain(b.name).startsWith(nq)) - Number(plain(a.name).startsWith(nq)))
}
