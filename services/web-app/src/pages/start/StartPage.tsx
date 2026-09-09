import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DashShell } from '../../components/DashShell'
import { DashLogoHeader } from '../../components/DashLogoHeader'
import { EssentialPagesPanel } from '../../components/EssentialPagesPanel'
import { ThemeToggle } from '../../ThemeToggle'
import { AccountModal } from '../AccountModal'
import { useDocumentTitle } from '../../useDocumentTitle'
import { StartJoinPage } from './StartJoinPage'
import { StartNewPage } from './StartNewPage'

export type PSelection = 'join' | 'new' | null

export interface StartPageProps {
  selected: PSelection
  onSelectJoin: () => void
  onSelectNew: () => void
  onBack: () => void
  onComplete: (sessionId: string) => void
}

// The /p chooser — same DashShell three-column layout as SessionPage
// (see DashShell.tsx), with the sidebar's session history swapped for the
// two Join/New options, and the center panel swapped for whichever of
// StartJoinPage/StartNewPage (in their chrome-less `embedded` mode) the
// user picked, instead of chat messages.
export function StartPage({ selected, onSelectJoin, onSelectNew, onBack, onComplete }: StartPageProps) {
  const { t } = useTranslation('start')
  useDocumentTitle(t('choose.documentTitle'))
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [accountModalOpen, setAccountModalOpen] = useState(false)

  function selectAndClose(select: () => void) {
    select()
    setMobileMenuOpen(false)
  }

  const sidebarHeader = <DashLogoHeader onAccountClick={() => setAccountModalOpen(true)} />

  const sidebarList = (
    <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div
        onClick={() => selectAndClose(onSelectJoin)}
        style={{
          cursor: 'pointer',
          padding: 'var(--space-2)',
          borderRadius: 'var(--radius-md)',
          background: selected === 'join' ? 'var(--accent-safe-surface)' : 'transparent',
        }}
      >
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)' }}>
          {t('choose.joinTitle')}
        </div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{t('choose.joinSubtitle')}</div>
      </div>
      <div
        onClick={() => selectAndClose(onSelectNew)}
        style={{
          cursor: 'pointer',
          padding: 'var(--space-2)',
          borderRadius: 'var(--radius-md)',
          background: selected === 'new' ? 'var(--accent-safe-surface)' : 'transparent',
        }}
      >
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)' }}>
          {t('choose.newTitle')}
        </div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{t('choose.newSubtitle')}</div>
      </div>
    </div>
  )

  const center = (
    <div className="dash-center" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div
        className="dash-panel-header"
        style={{ borderBottom: '0.5px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
          <button
            type="button"
            className="dash-mobile-toggle"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-expanded={mobileMenuOpen}
            aria-label={t('choose.toggleMenu')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)' }}>
            {t('choose.title')}
          </div>
        </div>
        <ThemeToggle />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)' }}>
        {selected === 'join' && <StartJoinPage embedded onBack={onBack} onComplete={onComplete} />}
        {selected === 'new' && <StartNewPage embedded onBack={onBack} onComplete={onComplete} />}
        {selected === null && (
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{t('choose.subtitle')}</div>
        )}
      </div>
    </div>
  )

  return (
    <>
      <AccountModal isOpen={accountModalOpen} onOpenChange={setAccountModalOpen} />
      <DashShell
        sidebarHeader={sidebarHeader}
        sidebarList={sidebarList}
        rightPanelContent={<EssentialPagesPanel onLinkClick={() => setMobileMenuOpen(false)} />}
        mobileMenuOpen={mobileMenuOpen}
        onCloseMobileMenu={() => setMobileMenuOpen(false)}
        center={center}
      />
    </>
  )
}
