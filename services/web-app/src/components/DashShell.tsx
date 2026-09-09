import type { ReactNode } from 'react'
import './DashShell.css'

// Shared three-column app shell — sidebar (session list on /s, the
// Join/New chooser on /p) + a center panel + a right-hand companion
// column, collapsing below 768px into a slide-in drawer (see
// SessionPage.css's single `@media (max-width: 768px)` rule, whose
// `.dash-*` class names this renders verbatim so no page using this shell
// needs its own copy of that CSS). `sidebarHeader`/`sidebarList` are kept
// as separate slots (not one combined `sidebarContent` node) because the
// mobile drawer renders them in different wrapper elements
// (`dash-drawer__header`/`dash-drawer__list`) than the desktop sidebar
// does.
export function DashShell({
  sidebarHeader,
  sidebarList,
  center,
  rightPanelContent,
  mobileMenuOpen,
  onCloseMobileMenu,
}: {
  sidebarHeader: ReactNode
  sidebarList: ReactNode
  center: ReactNode
  rightPanelContent: ReactNode
  mobileMenuOpen: boolean
  onCloseMobileMenu: () => void
}) {
  return (
    <div className="dash-root" style={{ display: 'flex', height: '100%', fontFamily: 'var(--font-family-base)', background: 'var(--surface-app)' }}>
      {/* Sidebar */}
      <div
        className="dash-sidebar"
        style={{
          width: 260,
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '0.5px solid var(--border-subtle)',
          padding: 'var(--space-5) var(--space-4)',
          gap: 'var(--space-4)',
          background: 'var(--surface-raised)',
        }}
      >
        {sidebarHeader}
        {sidebarList}
      </div>

      {mobileMenuOpen && <div className="dash-drawer-backdrop" onClick={onCloseMobileMenu} />}

      <div className={['dash-drawer', mobileMenuOpen && 'dash-drawer--open'].filter(Boolean).join(' ')}>
        <div className="dash-drawer__header">{sidebarHeader}</div>
        <div className="dash-drawer__list">{sidebarList}</div>
        <div className="dash-drawer__footer">{rightPanelContent}</div>
      </div>

      {center}

      {/* Desktop-only companion column for rightPanelContent — hidden
          below 768px (see SessionPage.css's .dash-right rule), where
          the same content instead lives in the mobile drawer's footer
          above. */}
      <div
        className="dash-right"
        style={{
          width: 260,
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '0.5px solid var(--border-subtle)',
          padding: 'var(--space-5) var(--space-4)',
          gap: 'var(--space-4)',
          background: 'var(--surface-raised)',
          overflowY: 'auto',
        }}
      >
        {rightPanelContent}
      </div>
    </div>
  )
}
