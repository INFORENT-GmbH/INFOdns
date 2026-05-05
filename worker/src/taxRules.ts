// COPY — keep in sync with api/src/billing/taxRules.ts
// Steuermodus → effektiver Satz + DE-rechtskonformer Hinweistext.
// Pure functions, keine DB-Zugriffe.

export type TaxMode = 'standard' | 'reverse_charge' | 'small_business' | 'non_eu'

export interface TenantTaxContext {
  tax_mode: TaxMode
  tax_rate_percent_override: number | null
  vat_id: string | null
  country: string | null
}

export interface SettingsTaxContext {
  default_tax_rate_percent: number
}

export interface ResolvedTax {
  rate: number
  mode: TaxMode
  /** Pflicht-Hinweistext für die Rechnung, falls Steuerbefreiung. NULL = nichts drucken. */
  note: string | null
}

/**
 * Bestimmt den effektiven Steuersatz und ggf. den Hinweistext für die Rechnung.
 *
 * Regeln:
 * - small_business → 0%, §19 UStG-Hinweis (egal welcher Override gesetzt ist)
 * - reverse_charge → 0%, §13b UStG-Hinweis (vat_id sollte gesetzt sein)
 * - non_eu        → 0%, "nicht steuerbar"-Hinweis
 * - standard      → Override (falls gesetzt) sonst Settings-Default, kein Hinweis
 */
export function resolveTax(tenant: TenantTaxContext, settings: SettingsTaxContext): ResolvedTax {
  switch (tenant.tax_mode) {
    case 'small_business':
      return {
        rate: 0,
        mode: 'small_business',
        note: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
      }
    case 'reverse_charge':
      return {
        rate: 0,
        mode: 'reverse_charge',
        note: 'Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG / Reverse-Charge).',
      }
    case 'non_eu':
      return {
        rate: 0,
        mode: 'non_eu',
        note: 'Nicht steuerbarer Umsatz (Drittlandsleistung).',
      }
    case 'standard':
    default: {
      const rate = tenant.tax_rate_percent_override != null
        ? Number(tenant.tax_rate_percent_override)
        : Number(settings.default_tax_rate_percent)
      return { rate, mode: 'standard', note: null }
    }
  }
}

/**
 * Effektiver Steuersatz für eine einzelne Position. Posten-eigener Satz wirkt
 * nur im 'standard'-Modus; bei reverse_charge/§19/non_eu greift der Tenant-Mode
 * zwingend (sonst fehlerhafter Steuerausweis).
 */
export function lineTaxRate(
  itemTaxRate: number | null | undefined,
  resolved: ResolvedTax,
): number {
  if (resolved.mode !== 'standard') return 0
  if (itemTaxRate == null) return resolved.rate
  return Number(itemTaxRate)
}

/** Berechnet Steuerbetrag (Cent) aus Netto + Satz. Math.round je Position. */
export function computeLineTax(subtotal_cents: number, rate_percent: number): number {
  return Math.round(subtotal_cents * rate_percent / 100)
}
