import { useEffect, useRef, useState, type CSSProperties } from 'react'

interface Props {
  /** Wert in Cent (Storage-Format). null/undefined → leer. */
  cents: number | null | undefined
  /** Aufgerufen wenn der Nutzer das Feld verlässt — IMMER in Cent. */
  onChange: (cents: number) => void
  disabled?: boolean
  placeholder?: string
  style?: CSSProperties
  /** Erlaube Negativwerte (Storno-Positionen, Gutschriften). Default false. */
  allowNegative?: boolean
  /** Optionales Suffix-Symbol. Default "€". */
  suffix?: string
  /** className für Tests / globale Focus-Styles. */
  className?: string
}

/**
 * Eingabefeld für Euro-Beträge — Storage immer in Cent, Anzeige in Euro mit
 * deutschem Komma. Akzeptiert sowohl "12,34" als auch "12.34" beim Tippen,
 * normalisiert beim Verlassen des Felds (blur) und committed dann via onChange.
 *
 * Beispiel: cents=1234 → Anzeige "12,34". Tippt User "9,9" → on blur: 990 cents,
 * Anzeige "9,90".
 */
export default function EuroInput({
  cents, onChange, disabled, placeholder, style, allowNegative = false, suffix = '€', className,
}: Props) {
  const [text, setText] = useState<string>(centsToText(cents))
  const lastCommittedCents = useRef<number | null | undefined>(cents)

  // Sync von außen, wenn sich cents ändern und das Feld nicht gerade fokussiert ist
  useEffect(() => {
    if (cents !== lastCommittedCents.current) {
      setText(centsToText(cents))
      lastCommittedCents.current = cents
    }
  }, [cents])

  function commit() {
    const parsed = parseEuroText(text, allowNegative)
    if (parsed == null) {
      // Ungültig → zurück auf letzten Wert
      setText(centsToText(lastCommittedCents.current))
      return
    }
    setText(centsToText(parsed))
    lastCommittedCents.current = parsed
    onChange(parsed)
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...(style ?? {}) }}>
      <input
        className={className}
        type="text"
        inputMode="decimal"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        disabled={disabled}
        placeholder={placeholder ?? '0,00'}
        style={inputStyle}
      />
      <span style={suffixStyle}>{suffix}</span>
    </span>
  )
}

const inputStyle: CSSProperties = {
  padding: '.375rem 1.6rem .375rem .625rem',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  fontSize: '.8125rem',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  width: '100%',
  boxSizing: 'border-box',
}
const suffixStyle: CSSProperties = {
  position: 'absolute',
  right: 8,
  pointerEvents: 'none',
  color: '#9ca3af',
  fontSize: '.75rem',
  fontWeight: 500,
}

function centsToText(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return ''
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const euros = Math.floor(abs / 100)
  const remainder = abs % 100
  return `${sign}${euros},${String(remainder).padStart(2, '0')}`
}

function parseEuroText(raw: string, allowNegative: boolean): number | null {
  let s = raw.trim()
  if (s === '') return 0
  const negative = s.startsWith('-')
  if (negative) {
    if (!allowNegative) return null
    s = s.slice(1).trim()
  }
  // Akzeptiere Komma ODER Punkt als Dezimaltrenner. Tausendertrenner werden
  // ignoriert (sowohl '.' als auch ',') — wir gucken auf das LETZTE Vorkommen.
  // Das deckt "1.234,56", "1,234.56" und "1234,56" alle ab.
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let intPart: string, fracPart: string
  const decIdx = Math.max(lastComma, lastDot)
  if (decIdx >= 0 && s.length - decIdx <= 3) {
    intPart = s.slice(0, decIdx).replace(/[.,]/g, '')
    fracPart = s.slice(decIdx + 1)
  } else {
    intPart = s.replace(/[.,]/g, '')
    fracPart = ''
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null
  if (intPart === '' && fracPart === '') return null
  const cents = (Number(intPart || '0') * 100) + Number((fracPart + '00').slice(0, 2))
  if (Number.isNaN(cents)) return null
  return negative ? -cents : cents
}

// Exporte für Tests/Reuse
export { centsToText, parseEuroText }
