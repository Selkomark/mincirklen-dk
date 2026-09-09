import { useTranslation } from 'react-i18next'
import { Select, SelectItem } from './components/Select'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './languages'
import { useSetLanguage } from './App'
import './LanguageSwitcher.css'

// The design system's own Select, not a native <select> — a native select
// renders the OS's own dropdown chrome, which looks out of place next to
// every other styled control in the header. Changes the URL's language
// segment (useSetLanguage, App.tsx) rather than calling
// i18n.changeLanguage() directly — the URL is authoritative for language,
// so Shell's own effect is what actually applies the change, the same
// path a shared link with a different language segment goes through. For
// a logged-in user, the durable preference still lives in the Account
// modal's Preferences section (AccountModal.tsx), which does the same
// URL-navigation rather than its own separate mechanism. For an anonymous
// visitor, i18next-browser-languagedetector's `caches: ['localStorage']`
// (i18n.ts) persists this pick automatically — there's no profile to
// save it to yet.
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common')
  const setLanguage = useSetLanguage()

  return (
    <Select
      aria-label={t('language')}
      className="language-switcher"
      selectedKey={i18n.resolvedLanguage ?? i18n.language}
      onSelectionChange={(key) => setLanguage(key as SupportedLanguage)}
    >
      {SUPPORTED_LANGUAGES.map((l) => (
        <SelectItem key={l.code} id={l.code}>
          {l.nativeName}
        </SelectItem>
      ))}
    </Select>
  )
}
