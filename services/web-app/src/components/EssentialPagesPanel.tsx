import { useTranslation } from 'react-i18next'
import { PUBLIC_PAGES, publicPagePath } from '../publicPages/pages'
import { moderationTransparencyPath, useLocale } from '../App'

// The "Essential pages" links list shared by every DashShell right-hand
// column (SessionPage, the /p chooser). `onLinkClick` closes the mobile
// drawer these links can also render inside — a no-op is fine on pages
// with no such drawer state to close.
export function EssentialPagesPanel({ onLinkClick }: { onLinkClick?: () => void }) {
  const { t } = useTranslation('session')
  const locale = useLocale()
  return (
    <div>
      <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
        {t('rightPanel.essentialPages')}
      </div>
      {(['how-it-works', 'safety-and-moderation', 'account-and-data'] as const).map((id) => (
        <div key={id}>
          <a
            href={publicPagePath(id, locale)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onLinkClick}
            className="ds-inline-link"
            style={{
              display: 'block',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-primary)',
              textDecoration: 'none',
              padding: 'var(--space-2) 0',
            }}
          >
            {id === 'safety-and-moderation' ? 'Safety' : PUBLIC_PAGES[id].title}
          </a>
          {id === 'safety-and-moderation' && (
            <a
              href={moderationTransparencyPath(locale)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onLinkClick}
              className="ds-inline-link"
              style={{
                display: 'block',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-primary)',
                textDecoration: 'none',
                padding: 'var(--space-2) 0',
              }}
            >
              {t('rightPanel.transparency')}
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
