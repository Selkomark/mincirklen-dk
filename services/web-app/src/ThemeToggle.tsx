import { useTranslation } from 'react-i18next'
import { useTheme } from './components/ThemeProvider'
import { IconButton } from './components/IconButton'

export function ThemeToggle() {
  const { t } = useTranslation('common')
  const { theme, toggleTheme } = useTheme()
  return <IconButton icon={theme === 'dark' ? '☀' : '☾'} label={t('toggleTheme')} onClick={toggleTheme} />
}
