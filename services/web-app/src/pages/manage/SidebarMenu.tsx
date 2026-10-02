import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover, Separator } from 'react-aria-components'
import { IconButton } from '../../components/IconButton'
import { useTheme } from '../../components/ThemeProvider'
import { landingPath, useLocale, useSetLanguage } from '../../App'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../languages'
import { logout } from '../../logout'
import '../../components/Menu/Menu.css'
import './SidebarMenu.css'

// The admin sidebar's one utility menu — language, theme, log out —
// behind a single hamburger trigger, the same shape SessionPage.tsx uses
// for its own header toggle. Before this the sidebar had a theme button
// and a log-out row but no way to change language at all; one menu holds
// all three without adding chrome to the sidebar.
//
// Built on react-aria-components' Menu primitives with the design
// system's `ds-menu*` classes (components/Menu) rather than the DS
// `Menu` wrapper, which fixes its trigger to a bordered text button and
// has no sections or selection — a language picker needs both.
export function SidebarMenu({ onLogoutError }: { onLogoutError: (message: string) => void }) {
  const { t, i18n } = useTranslation('console')
  const { theme, toggleTheme } = useTheme()
  const locale = useLocale()
  const setLanguage = useSetLanguage()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const currentLanguage = i18n.resolvedLanguage ?? i18n.language

  async function handleLogout() {
    setIsLoggingOut(true)
    try {
      await logout()
      window.location.href = landingPath(locale)
    } catch (err) {
      onLogoutError(err instanceof Error ? err.message : t('menu.logoutFailed'))
      setIsLoggingOut(false)
    }
  }

  return (
    <MenuTrigger>
      <IconButton
        label={t('menu.label')}
        isDisabled={isLoggingOut}
        icon={
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        }
      />
      <Popover className="ds-menu__popover" placement="bottom end">
        <Menu className="ds-menu console-menu">
          {/* Language is a single-select section so the current one reads
              as chosen, not as an action. Selecting navigates to the same
              path under the new language segment (useSetLanguage) — the
              URL is authoritative for language, same as LanguageSwitcher. */}
          <MenuSection
            selectionMode="single"
            selectedKeys={[currentLanguage]}
            onSelectionChange={(keys) => {
              if (keys === 'all') return
              const [next] = [...keys]
              if (next && next !== currentLanguage) setLanguage(next as SupportedLanguage)
            }}
          >
            <Header className="console-menu__header">{t('menu.language')}</Header>
            {SUPPORTED_LANGUAGES.map((language) => (
              <MenuItem key={language.code} id={language.code} className="ds-menu__item console-menu__item">
                {({ isSelected }) => (
                  <>
                    <span className="console-menu__check" aria-hidden="true">
                      {isSelected ? '✓' : ''}
                    </span>
                    {language.nativeName}
                  </>
                )}
              </MenuItem>
            ))}
          </MenuSection>
          <Separator className="console-menu__separator" />
          <MenuItem className="ds-menu__item console-menu__item" onAction={toggleTheme}>
            <span className="console-menu__check" aria-hidden="true">
              {theme === 'dark' ? '☀' : '☾'}
            </span>
            {theme === 'dark' ? t('menu.lightMode') : t('menu.darkMode')}
          </MenuItem>
          <Separator className="console-menu__separator" />
          <MenuItem className="ds-menu__item console-menu__item console-menu__item--urgent" onAction={() => void handleLogout()}>
            <span className="console-menu__check" aria-hidden="true" />
            {t('menu.logOut')}
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
