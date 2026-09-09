import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Alert } from '../../components/Alert'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { landingPath, managePath, pPath, useLocale, type ManageSection } from '../../App'
import { logout } from '../../logout'
import { ThemeToggle } from '../../ThemeToggle'
import { ErrorPage } from '../ErrorPage'
import { useDocumentTitle } from '../../useDocumentTitle'
import { hasAccess, useAccess, type Access } from './useAccess'
import { RolesTab } from './RolesTab'
import { UsersTab } from './UsersTab'
import { ReviewQueueTab } from './ReviewQueueTab'

const SIDEBAR_BG = '#171717'
const SIDEBAR_TEXT = '#d4d4d4'
const SIDEBAR_TEXT_MUTED = '#737373'
const SIDEBAR_ACTIVE_BG = '#262626'
const SIDEBAR_BORDER = '#2e2e2e'

interface NavItem {
  section: ManageSection
  label: string
  permission: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

// Grouped, not flat — "Access control" reads as one cohesive section for
// whoever holds roles.read/users.read, same as selkomark.com's own
// "Governance" grouping of Users+Roles. A group renders only if at least
// one of its items is visible to the current user (see visibleGroups
// below); an empty group would be a dead heading.
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Moderation',
    items: [{ section: 'review', label: 'Review queue', permission: 'moderation_events.review' }],
  },
  {
    label: 'Access control',
    items: [
      { section: 'users', label: 'Users', permission: 'users.read' },
      { section: 'roles', label: 'Roles & permissions', permission: 'roles.read' },
    ],
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
      {item.label}
    </a>
  )
}

function LogoutRow() {
  const { t } = useTranslation('landing')
  const locale = useLocale()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogout() {
    setError(null)
    setIsLoggingOut(true)
    try {
      await logout()
      window.location.href = landingPath(locale)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.logoutFailed'))
      setIsLoggingOut(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {error && <Alert variant="urgent">{error}</Alert>}
      <Button variant="ghost" isPending={isLoggingOut} onPress={() => void handleLogout()} style={{ width: '100%', color: SIDEBAR_TEXT }}>
        {t('header.logOut')}
      </Button>
    </div>
  )
}

function Sidebar({
  access,
  activeSection,
  onNavigate,
  onLogoClick,
}: {
  access: Access
  activeSection: ManageSection
  onNavigate: (section: ManageSection) => void
  onLogoClick: () => void
}) {
  const locale = useLocale()
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasAccess(access, item.permission)),
  })).filter((group) => group.items.length > 0)

  return (
    <aside
      style={{
        width: 240,
        flex: 'none',
        background: SIDEBAR_BG,
        color: SIDEBAR_TEXT,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div style={{ padding: '20px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <LogoMark onClick={onLogoClick} />
        <ThemeToggle />
      </div>

      <nav style={{ flex: 1, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {visibleGroups.length === 0 ? (
          <div style={{ padding: '8px 12px', fontSize: 'var(--font-size-sm)', color: SIDEBAR_TEXT_MUTED }}>No sections available</div>
        ) : (
          visibleGroups.map((group) => (
            <div key={group.label} style={{ marginBottom: 4 }}>
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
                {group.label}
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
          ← Back to site
        </a>
        <LogoutRow />
      </div>
    </aside>
  )
}

function SectionContent({ section }: { section: ManageSection }) {
  if (section === 'review') return <ReviewQueueTab />
  if (section === 'roles') return <RolesTab />
  return <UsersTab />
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
  useDocumentTitle('Manage — MinCirklen')
  const status = useAccess()

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

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <Sidebar
        access={access}
        activeSection={activeSection ?? 'review'}
        onNavigate={onNavigate}
        onLogoClick={() => firstAccessible && onNavigate(firstAccessible)}
      />
      <main style={{ flex: 1, overflow: 'auto', padding: 'clamp(20px, 4vw, 32px)' }}>
        {activeSection ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 960 }}>
            <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
              {NAV_ITEMS.find((item) => item.section === activeSection)?.label}
            </h1>
            <SectionContent section={activeSection} />
          </div>
        ) : (
          <div style={{ color: 'var(--text-secondary)' }}>Nothing to show — you have admin access but no section permissions yet.</div>
        )}
      </main>
    </div>
  )
}
