import { useTranslation } from 'react-i18next'
import { SiteHeader } from '../../SiteHeader'
import { SiteFooter } from '../../SiteFooter'
import { useDocumentTitle } from '../../useDocumentTitle'

export interface StartPageProps {
  onChooseJoin: () => void
  onChooseNew: () => void
}

export function StartPage({ onChooseJoin, onChooseNew }: StartPageProps) {
  const { t } = useTranslation('start')
  useDocumentTitle(t('choose.documentTitle'))

  return (
    <div style={{ minHeight: '100vh', fontFamily: 'var(--font-family-base)' }}>
      <SiteHeader showJoinCta={false} />

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: 'clamp(20px, 6vw, 64px) clamp(16px, 5vw, 24px)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 'clamp(20px, 4vw, 28px)' }}>
          <div
            style={{
              background: 'var(--surface-raised)',
              border: '0.5px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: 'clamp(20px, 4vw, 32px)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
                  {t('choose.title')}
                </div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>
                  {t('choose.subtitle')}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div
                  onClick={onChooseJoin}
                  style={{ cursor: 'pointer', flex: '1 1 220px', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: 18 }}
                >
                  <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
                    {t('choose.joinTitle')}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>
                    {t('choose.joinSubtitle')}
                  </div>
                </div>
                <div
                  onClick={onChooseNew}
                  style={{ cursor: 'pointer', flex: '1 1 220px', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: 18 }}
                >
                  <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
                    {t('choose.newTitle')}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>
                    {t('choose.newSubtitle')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
