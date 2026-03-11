import { createContext, useContext, useState, type ReactNode } from 'react'
import { translations, type Locale, type TranslationKey } from './translations'

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: TranslationKey, ...args: any[]) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

const STORAGE_KEY = 'infodns_locale'

function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'de') return stored
  // Browser language: default to German if German browser
  const lang = navigator.language.toLowerCase()
  return lang.startsWith('de') ? 'de' : 'de' // default to German per product requirement
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  function setLocale(l: Locale) {
    setLocaleState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }

  function t(key: TranslationKey, ...args: any[]): string {
    const entry = translations[locale][key] ?? translations.en[key]
    if (typeof entry === 'function') return (entry as (...a: any[]) => string)(...args)
    return entry as string
  }

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
