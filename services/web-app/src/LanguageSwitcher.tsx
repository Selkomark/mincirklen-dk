import { useTranslation } from 'react-i18next'
import { Select, SelectItem } from './components/Select'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './languages'
import './LanguageSwitcher.css'

// The design system's own Select, not a native <select> — a native select
// renders the OS's own dropdown chrome, which looks out of place next to
// every other styled control in the header. For a logged-in user this
// changes only the active display language for this session; their
// durable preference still lives in the Account modal's Preferences
// section (SessionPage.tsx), which calls i18n.changeLanguage() the same
// way. For an anonymous visitor, i18next-browser-languagedetector's
// `caches: ['localStorage']` (i18n.ts) persists this pick automatically —
// there's no profile to save it to yet.
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common')

  return (
    <Select
      aria-label={t('language')}
      className="language-switcher"
      selectedKey={i18n.resolvedLanguage ?? i18n.language}
      onSelectionChange={(key) => void i18n.changeLanguage(key as SupportedLanguage)}
    >
      {SUPPORTED_LANGUAGES.map((l) => (
        <SelectItem key={l.code} id={l.code}>
          {l.nativeName}
        </SelectItem>
      ))}
    </Select>
  )
}
