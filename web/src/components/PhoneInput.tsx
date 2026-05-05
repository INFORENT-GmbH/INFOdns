import { useEffect, useRef, useState, type CSSProperties } from 'react'

interface Props {
  value: string | null | undefined
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  style?: CSSProperties
  className?: string
  /** Default-Land für Eingaben ohne führendes "+". Default 'DE'. */
  defaultCountry?: 'DE' | 'AT' | 'CH'
}

/**
 * Telefonnummer-Eingabe mit lesbarer Formatierung beim Verlassen des Felds.
 * - Normalisiert "0" oder "0049" am Anfang zu "+49"
 * - Gruppiert Vorwahl + Hauptnummer mit Leerzeichen
 * - Behält Durchwahl ("-1234") bei
 *
 * Speichert immer im E.164-ähnlichen Lesefurmat ("+49 30 1234-567"), nicht in
 * strikt E.164. Genug für Adressdaten / Briefe / Anzeige im UI.
 */
export default function PhoneInput({
  value, onChange, disabled, placeholder, style, className,
  defaultCountry = 'DE',
}: Props) {
  const [text, setText] = useState<string>(value ?? '')
  const lastCommitted = useRef<string>(value ?? '')

  useEffect(() => {
    const normalized = (value ?? '')
    if (normalized !== lastCommitted.current) {
      setText(normalized)
      lastCommitted.current = normalized
    }
  }, [value])

  function commit() {
    const formatted = formatPhone(text, defaultCountry)
    setText(formatted)
    if (formatted !== lastCommitted.current) {
      lastCommitted.current = formatted
      onChange(formatted)
    }
  }

  return (
    <input
      type="tel"
      className={className}
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      disabled={disabled}
      placeholder={placeholder ?? '+49 30 12345-678'}
      style={inputStyle(style)}
    />
  )
}

function inputStyle(extra?: CSSProperties): CSSProperties {
  return {
    padding: '.375rem .625rem',
    border: '1px solid #e2e8f0',
    borderRadius: 4,
    fontSize: '.8125rem',
    fontFamily: 'inherit',
    ...extra,
  }
}

const DIAL_CODES: Record<string, string> = { DE: '49', AT: '43', CH: '41' }

// Bekannte internationale Vorwahlen, längste zuerst gemappt — verhindert
// dass z.B. "+49…" greedy als "+493" geparst wird.
const KNOWN_DIALS = [
  '1242','1264','1268','1284','1340','1345','1441','1473','1649','1664',
  '1670','1671','1684','1758','1767','1784','1809','1829','1849','1868','1869','1876','1939',
  '880','881','882','883','886','420','421','423','590','591','592','593','594','595','596','597','598',
  '500','501','502','503','504','505','506','507','508','509','670','672','673','674','675','676','677',
  '678','679','680','681','682','683','685','686','687','688','689','690','691','692',
  '350','351','352','353','354','355','356','357','358','359','370','371','372','373','374','375','376','377','378','379','380','381','382','383','385','386','387','389',
  '960','961','962','963','964','965','966','967','968','970','971','972','973','974','975','976','977','992','993','994','995','996','998',
  '212','213','216','218','220','221','222','223','224','225','226','227','228','229','230','231','232','233','234','235','236','237','238','239','240','241','242','243','244','245','246','247','248','249','250','251','252','253','254','255','256','257','258','260','261','262','263','264','265','266','267','268','269','290','291','297','298','299',
  '20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49','51','52','53','54','55','56','57','58','60','61','62','63','64','65','66','81','82','84','86','90','91','92','93','94','95','98',
  '1','7',
]
function detectDialCode(rest: string): { dial: string; subscriber: string } | null {
  for (const d of KNOWN_DIALS) {
    if (rest.startsWith(d)) return { dial: d, subscriber: rest.slice(d.length) }
  }
  return null
}

/**
 * Formatiert eine Telefonnummer in lesbare Darstellung. Heuristik:
 * - Leere Eingabe → ""
 * - "+XX …" bleibt "+XX rest"
 * - "0049…", "00 49 …" → "+49 …"
 * - Führende "0" → "+<defaultDial> …" (national → international)
 * - Sonst: durchreichen, nur cleanen
 *
 * Innere Struktur: Vorwahl-Gruppe (3-5 Stellen) + Rest, optional Durchwahl
 * nach "-".
 */
export function formatPhone(raw: string, defaultCountry: 'DE' | 'AT' | 'CH' = 'DE'): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''

  // Behalte explizite Durchwahl ("-1234" am Ende) für später. Maximal 4
  // Ziffern, sonst ist es eher Teil der Hauptnummer (z.B. "0421/1234567").
  let extension: string | null = null
  const extMatch = trimmed.match(/-\s*(\d{1,4})\s*$/)
  let body = trimmed
  if (extMatch) {
    extension = extMatch[1]
    body = trimmed.slice(0, extMatch.index!)
  }

  // Nur Ziffern + führendes + behalten.
  let digits = body.replace(/[^\d+]/g, '')

  // Internationales Präfix normalisieren
  if (digits.startsWith('00')) digits = '+' + digits.slice(2)
  if (!digits.startsWith('+')) {
    if (digits.startsWith('0')) {
      const dial = DIAL_CODES[defaultCountry] ?? '49'
      digits = '+' + dial + digits.slice(1)
    } else {
      // Keine erkennbare Vorwahl — durchreichen ohne Format
      const out = digits.replace(/(\d{3,4})(?=\d)/g, '$1 ').trim()
      return extension ? `${out}-${extension}` : out
    }
  }

  // Aufteilen: +<countryDial><rest>. Längste bekannte Dialcodes zuerst.
  const det = detectDialCode(digits.slice(1))
  if (!det) return extension ? `${digits}-${extension}` : digits
  const dial = det.dial
  const rest = det.subscriber

  // Heuristik für die Vorwahl-Gruppe: deutsche Stadtvorwahlen 2-5 Stellen
  // (Berlin/Hamburg 2, viele 3-5). Mobil: 3 (z.B. 151, 160, 170).
  // Pragmatisch: 3 Stellen als Gruppe nehmen, Rest in Vierergruppen.
  const cityLen = guessCityCodeLength(dial, rest)
  const city = rest.slice(0, cityLen)
  const sub = rest.slice(cityLen)
  const subFmt = sub.replace(/(\d{4})(?=\d)/g, '$1 ').trim()

  let out = `+${dial} ${city}`
  if (subFmt) out += ' ' + subFmt
  if (extension) out += '-' + extension
  return out
}

function guessCityCodeLength(dial: string, rest: string): number {
  if (dial === '49') {
    // Deutsche Mobilnummern: 15x, 16x, 17x → 3-stellig
    if (/^1[567]/.test(rest)) return 3
    // Berlin/Hamburg: 30/40 → 2-stellig
    if (/^(30|40)/.test(rest)) return 2
    // Default: 3
    return Math.min(4, Math.max(3, rest.length - 4))
  }
  return 3
}
