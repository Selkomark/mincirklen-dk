import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { Alert } from '../../components/Alert'
import { Spinner } from '../../components/Spinner'
import { managePath, pPath, useLocale, type ManageSection } from '../../App'
import { ErrorPage } from '../ErrorPage'
import { useDocumentTitle } from '../../useDocumentTitle'
import { hasAccess, useAccess, type Access } from './useAccess'
import { useIdleLogout } from './useIdleLogout'
import { RolesTab } from './RolesTab'
import { UsersTab } from './UsersTab'
import { ReviewQueueTab } from './ReviewQueueTab'
import { GatesTab } from './GatesTab'
import { ReportsTab } from './ReportsTab'
import { EmailsTab } from './EmailsTab'
import { SidebarMenu } from './SidebarMenu'
import './ManagePage.css'

const SIDEBAR_BG = '#171717'
const SIDEBAR_TEXT = '#d4d4d4'
const SIDEBAR_TEXT_MUTED = '#737373'
const SIDEBAR_ACTIVE_BG = '#262626'
const SIDEBAR_BORDER = '#2e2e2e'

// Labels are `console` namespace keys (locales/*/console.json → nav.*),
// resolved at render via t(), so the sidebar follows the admin's
// language like the rest of the app.
interface NavItem {
  section: ManageSection
  labelKey: 'nav.review' | 'nav.reports' | 'nav.users' | 'nav.roles' | 'nav.gates' | 'nav.emails'
  permission: string
}

interface NavGroup {
  labelKey: 'nav.moderation' | 'nav.accessControl' | 'nav.earlyAccess' | 'nav.communication'
  items: NavItem[]
}

// Grouped, not flat — "Access control" reads as one cohesive section for
// whoever holds roles.read/users.read, same as selkomark.com's own
// "Governance" grouping of Users+Roles. A group renders only if at least
// one of its items is visible to the current user (see visibleGroups
// below); an empty group would be a dead heading.
const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.moderation',
    items: [
      { section: 'review', labelKey: 'nav.review', permission: 'moderation_events.read' },
      { section: 'reports', labelKey: 'nav.reports', permission: 'session_reports.read' },
    ],
  },
  {
    labelKey: 'nav.accessControl',
    items: [
      { section: 'users', labelKey: 'nav.users', permission: 'users.read' },
      { section: 'roles', labelKey: 'nav.roles', permission: 'roles.read' },
    ],
  },
  {
    labelKey: 'nav.earlyAccess',
    items: [{ section: 'gates', labelKey: 'nav.gates', permission: 'gates.read' }],
  },
  {
    labelKey: 'nav.communication',
    items: [{ section: 'emails', labelKey: 'nav.emails', permission: 'emails.read' }],
  },
]

const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)

// Clicking the brand mark stays inside /manage — "back to the site itself"
// is the sidebar's own dedicated link below, a different action.
function LogoMark({ onClick }: { onClick: () => void }) {
  const locale = useLocale()
  return (
    <a
      href={managePath(locale)}
      onClick={(e) => {
        e.preventDefault()
        onClick()
      }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, color: SIDEBAR_TEXT, textDecoration: 'none' }}
    >
      <div style={{ width: 20, height: 20, borderRadius: 'var(--radius-full)', border: '1.5px solid currentColor', flex: 'none' }} />
      <span style={{ fontWeight: 'var(--font-weight-bold)' }}>MinCirklen</span>
    </a>
  )
}

function NavLink({ item, isActive, onNavigate }: { item: NavItem; isActive: boolean; onNavigate: (section: ManageSection) => void }) {
  const { t } = useTranslation('console')
  const locale = useLocale()
  return (
    <a
      href={managePath(locale, item.section)}
      onClick={(e) => {
        e.preventDefault()
        onNavigate(item.section)
      }}
      style={{
        display: 'block',
        padding: '8px 12px',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-medium)',
        textDecoration: 'none',
        color: isActive ? '#fff' : SIDEBAR_TEXT,
        background: isActive ? SIDEBAR_ACTIVE_BG : 'transparent',
      }}
    >
      {t(item.labelKey)}
    </a>
  )
}

function Sidebar({
  access,
  activeSection,
  onNavigate,
  onLogoClick,
  isOpen,
}: {
  access: Access
  activeSection: ManageSection
  onNavigate: (section: ManageSection) => void
  onLogoClick: () => void
  // Only meaningful below 768px, where the sidebar is a drawer — see
  // ManagePage.css. On desktop it is always shown regardless.
  isOpen: boolean
}) {
  const { t } = useTranslation('console')
  const locale = useLocale()
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasAccess(access, item.permission)),
  })).filter((group) => group.items.length > 0)

  return (
    <aside className={['console-sidebar', isOpen && 'console-sidebar--open'].filter(Boolean).join(' ')} style={{ background: SIDEBAR_BG, color: SIDEBAR_TEXT }}>
      <div style={{ padding: '20px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <LogoMark onClick={onLogoClick} />
        {/* Language, theme and log out live behind this one trigger —
            see SidebarMenu.tsx. */}
        <SidebarMenu onLogoutError={setLogoutError} />
      </div>
      {logoutError && (
        <div style={{ padding: '0 12px 8px' }}>
          <Alert variant="urgent">{logoutError}</Alert>
        </div>
      )}

      <nav style={{ flex: 1, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {visibleGroups.length === 0 ? (
          <div style={{ padding: '8px 12px', fontSize: 'var(--font-size-sm)', color: SIDEBAR_TEXT_MUTED }}>{t('nav.noSections')}</div>
        ) : (
          visibleGroups.map((group) => (
            <div key={group.labelKey} style={{ marginBottom: 4 }}>
              <div
                style={{
                  padding: '8px 12px 4px',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 'var(--font-weight-bold)',
                  color: SIDEBAR_TEXT_MUTED,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {t(group.labelKey)}
              </div>
              {group.items.map((item) => (
                <NavLink key={item.section} item={item} isActive={item.section === activeSection} onNavigate={onNavigate} />
              ))}
            </div>
          ))
        )}
      </nav>

      <div style={{ padding: 16, borderTop: `1px solid ${SIDEBAR_BORDER}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {access.roles.map((role) => (
            <span
              key={role.id}
              style={{
                fontSize: 'var(--font-size-xs)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                background: SIDEBAR_ACTIVE_BG,
                color: SIDEBAR_TEXT,
              }}
            >
              {role.name}
            </span>
          ))}
        </div>
        <a href={pPath(locale)} style={{ fontSize: 'var(--font-size-sm)', color: SIDEBAR_TEXT, textDecoration: 'none' }}>
          {t('nav.backToSite')}
        </a>
      </div>
    </aside>
  )
}

// `access` is UX-only here, as everywhere in /manage — it decides which
// controls to show (the ban option, the add-note form); every action is
// re-gated server-side by hasPermission() regardless.
function SectionContent({ section, access }: { section: ManageSection; access: Access }) {
  const can = (slug: string) => hasAccess(access, slug)
  if (section === 'review') return <ReviewQueueTab canDecide={can('moderation_events.review')} />
  if (section === 'reports') return <ReportsTab canReview={can('session_reports.review')} canBan={can('users.ban')} />
  if (section === 'roles') {
    return (
      <RolesTab
        canCreateRole={can('roles.create')}
        canUpdateRole={can('roles.update')}
        canCreatePolicy={can('session_policies.create')}
      />
    )
  }
  if (section === 'gates') return <GatesTab canManage={can('gates.manage')} />
  if (section === 'emails') return <EmailsTab canSendTest={can('emails.send_test')} />
  return <UsersTab canEditRoles={can('users.update')} canAddNote={can('users.update')} canBan={can('users.ban')} />
}

// Reachable at /manage(/review|/roles|/users) by any regular, verified
// user (App.tsx's Shell gates on the same authStatus === 'verified' every
// other real feature uses) — the actual boundary here is RBAC, checked
// below via rbac.myAccess and, independently and for real, by
// hasPermission() on every procedure each section calls.
export function ManagePage({
  section,
  onNavigate,
}: {
  section: ManageSection | null
  onNavigate: (section: ManageSection) => void
}) {
  const { t } = useTranslation('errors')
  const { t: ct } = useTranslation('console')
  useDocumentTitle(ct('documentTitle'))
  const status = useAccess()
  // The phone-width nav drawer (ManagePage.css). Closes on every
  // navigation and on Escape, the way the session shell's drawer does.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  useEffect(() => {
    if (!mobileNavOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNavOpen])
  const navigate = (next: ManageSection) => {
    setMobileNavOpen(false)
    onNavigate(next)
  }
  // Called unconditionally (hooks rule) ahead of the loading/error
  // returns below — null while status isn't 'loaded' yet just means no
  // timer is armed until the real duration is known.
  useIdleLogout(status.kind === 'loaded' ? status.access.maxIdleSeconds : null)

  if (status.kind === 'loading') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spinner size={24} />
      </div>
    )
  }

  if (status.kind === 'error') {
    return <ErrorPage code={500} title={t('boundary.title')} message={t('boundary.message')} />
  }

  const { access } = status

  // This check is UX only — every section's actual data/actions are
  // independently re-gated server-side by hasPermission() regardless of
  // what renders here.
  if (!hasAccess(access, 'admin.access')) {
    return <ErrorPage code={403} title={t('forbidden.title')} message={t('forbidden.message')} />
  }

  const firstAccessible = NAV_ITEMS.find((item) => hasAccess(access, item.permission))?.section ?? null
  const activeSection = section && NAV_ITEMS.some((item) => item.section === section) ? section : firstAccessible

  const title = activeSection ? ct(NAV_ITEMS.find((item) => item.section === activeSection)?.labelKey ?? 'nav.review') : ct('documentTitle')

  return (
    <div className="console-root">
      {mobileNavOpen && <div className="console-drawer-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <Sidebar
        access={access}
        activeSection={activeSection ?? 'review'}
        onNavigate={navigate}
        onLogoClick={() => firstAccessible && navigate(firstAccessible)}
        isOpen={mobileNavOpen}
      />
      <main className="console-main">
        <div className="console-main__inner">
          <div className="console-header">
            <button
              type="button"
              className="console-mobile-toggle"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-expanded={mobileNavOpen}
              aria-label={ct('nav.toggleMenu')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <h1 className="console-header__title">{title}</h1>
          </div>
          {activeSection ? (
            <SectionContent section={activeSection} access={access} />
          ) : (
            <div style={{ color: 'var(--text-secondary)' }}>{ct('noSectionPermissions')}</div>
          )}
        </div>
      </main>
    </div>
  )
}
