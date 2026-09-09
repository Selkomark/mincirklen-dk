import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Key } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import { Checkbox } from '../components/Checkbox'
import { Switch } from '../components/Switch'
import { IconButton } from '../components/IconButton'
import { DialogTrigger, Popover, Dialog } from 'react-aria-components'
import { Modal } from '../components/Modal'
import { Textarea } from '../components/Textarea'
import { TextField } from '../components/TextField'
import { Select, SelectItem } from '../components/Select'
import { Alert } from '../components/Alert'
import { Skeleton } from '../components/Skeleton'
import { Spinner } from '../components/Spinner'
import { addToast } from '../components/Toast'
import { ThemeToggle } from '../ThemeToggle'
import { useTheme } from '../components/ThemeProvider'
import { usePreferences } from '../PreferencesProvider'
import { PUBLIC_PAGES, publicPagePath } from '../publicPages/pages'
import { COUNTRIES } from '../countries'
import { GENDERS } from '../genders'
import { SUPPORTED_LANGUAGES, detectDefaultLanguage, type SupportedLanguage } from '../languages'
import { moderationTransparencyPath, landingPath } from '../App'
import { useDocumentTitle } from '../useDocumentTitle'
import { useScrollShiftCompensation } from '../hooks/useScrollShiftCompensation'
import { logout } from '../logout'
import { StartJoinPage } from './start/StartJoinPage'
import { StartNewPage } from './start/StartNewPage'
import { Tabs, TabList, Tab, TabPanel } from '../components/Tabs'
import {
  type ChatMessage,
  type CrisisResource,
  type RecentVisit,
  type RosterEntry,
  type SessionSummary,
  agreeToGuidelines,
  checkGuidelines,
  getSessionSummary,
  reportFalsePositive,
  SendMessageConflictError,
  SkipTurnNotYourTurnError,
  skipTurn,
  submitSessionReport,
  useRecentVisits,
  useSessionChat,
  useTurnCountdown,
  useWhoAmI,
  visitDisplayName,
  visitSession,
} from './sessionShared'
import './SessionPage.css'

// Whether a turn-inactivity countdown reaching zero with a draft present
// auto-sends it, vs. always just auto-skipping (see useTurnCountdown's
// onExpire wiring below) — a per-browser preference, not per-session, so
// it sticks across every circle the same way the theme choice does (see
// ThemeProvider.tsx's identical read/write shape). Defaults to on: that
// matches the behavior before this toggle existed, so nobody's
// experience silently changes just because this shipped.
const AUTO_SEND_STORAGE_KEY = 'mincirklen-auto-send'

function getInitialAutoSend(): boolean {
  if (typeof window === 'undefined') return true
  const stored = window.localStorage.getItem(AUTO_SEND_STORAGE_KEY)
  return stored === null ? true : stored === 'true'
}

// Session pages have their own layout (no SiteHeader) — the account menu
// next to the brand logo in the sidebar is this page's equivalent of
// SiteHeader's "Log out" button. Same shared network call, same hard
// navigation on success; failure surfaces as a toast (not an inline Alert
// like SiteHeader's — a closed dropdown menu has no card/section left to
// put one in).
async function handleLogout(t: (key: string) => string) {
  try {
    await logout()
    window.location.href = landingPath()
  } catch {
    addToast(t('errors.logoutFailed'), { variant: 'urgent' })
  }
}

// Icons + a stable id only — title/description are translated at the
// render site (CommunityGuidelinesModal) via `t(`communityRules.${id}.title`)`.
const COMMUNITY_RULES = [
  { id: 'anonymity', icon: '🔒' },
  { id: 'noAdvertising', icon: '📢' },
  { id: 'noEndorsements', icon: '⚠️' },
  { id: 'supportDontDirect', icon: '🤝' },
  { id: 'reportOrLeave', icon: '🚨' },
] as const

// The DS Button has no disabled visual treatment (no opacity/cursor change in Button.css),
// so the final agreement step — which must stay disabled until the checkbox is checked —
// is built as a plain button carrying that state explicitly.
function PrimaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 44,
        padding: '0 22px',
        borderRadius: 'var(--radius-md)',
        border: 'none',
        background: 'var(--accent-safe)',
        color: 'var(--text-on-accent)',
        fontFamily: 'var(--font-family-base)',
        fontSize: 'var(--font-size-md)',
        fontWeight: 'var(--font-weight-medium)',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function CommunityGuidelinesModal({
  isOpen,
  onAgree,
  isAgreeing,
  agreedKeys,
}: {
  isOpen: boolean
  onAgree: () => void
  isAgreeing: boolean
  // Required keys (sessionRepository.ts's CIRCLE_GUIDELINE_AGREEMENT_KEYS)
  // this user has already agreed to, anywhere — pre-checks the matching
  // box(es) instead of showing a blank slate. Most commonly empty (first
  // time ever) or missing just one entry (a checkbox added after this
  // user last agreed).
  agreedKeys: string[]
}) {
  const { t } = useTranslation('session')
  const [step, setStep] = useState(0)
  // Three distinct consents, not one combined checkbox — this is the
  // single gate for every way of joining a circle (direct visit,
  // /start/join, "New session"), so it also covers what those flows' own
  // former step-2 checkboxes used to ask for. Each maps to its own
  // key(s) in CIRCLE_GUIDELINE_AGREEMENT_KEYS (sessionRepository.ts),
  // recorded with its own timestamp — resubmitting an already-agreed key
  // never disturbs its original timestamp (see
  // recordGuidelinesAgreement's merge semantics), so it's safe to always
  // submit all three on "Agree and continue" regardless of which were
  // already pre-checked.
  const [anonymityAcknowledged, setAnonymityAcknowledged] = useState(() => agreedKeys.includes('anonymity_acknowledgement'))
  const [guidelinesAgreed, setGuidelinesAgreed] = useState(
    () => agreedKeys.includes('community_guidelines') && agreedKeys.includes('privacy_policy'),
  )
  const [termsAgreed, setTermsAgreed] = useState(() => agreedKeys.includes('terms_of_service'))
  const agreed = anonymityAcknowledged && guidelinesAgreed && termsAgreed
  const totalSteps = COMMUNITY_RULES.length + 1
  const onLastRule = step === COMMUNITY_RULES.length - 1
  const onAgreementStep = step === COMMUNITY_RULES.length

  return (
    <Modal isOpen={isOpen} isDismissable={false} isKeyboardDismissDisabled>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: 3,
                  flex: 1,
                  borderRadius: 'var(--radius-full)',
                  background: i <= step ? 'var(--accent-safe)' : 'var(--border-subtle)',
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            {t('guidelinesModal.stepOf', { step: step + 1, total: totalSteps })}
          </span>
        </div>

        {!onAgreementStep ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ fontSize: 32 }}>{COMMUNITY_RULES[step].icon}</div>
            <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)' }}>
              {t(`communityRules.${COMMUNITY_RULES[step].id}.title`)}
            </div>
            <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', lineHeight: 'var(--line-height-base)' }}>
              {t(`communityRules.${COMMUNITY_RULES[step].id}.description`)}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)' }}>
                {t('guidelinesModal.beforeYouJoin')}
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 'var(--line-height-base)' }}>
                {t('guidelinesModal.nonNegotiable')}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <Checkbox isSelected={anonymityAcknowledged} onChange={setAnonymityAcknowledged} />
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                  {t('guidelinesModal.understandAnonymous')}
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <Checkbox isSelected={guidelinesAgreed} onChange={setGuidelinesAgreed} />
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                  {t('guidelinesModal.readAndAgreeToThePrefix')}{' '}
                  <a href={publicPagePath('community-guidelines')} target="_blank" rel="noopener noreferrer" className="ds-inline-link">
                    {t('guidelinesModal.communityGuidelines')}
                  </a>{' '}
                  {t('guidelinesModal.and')}{' '}
                  <a href={publicPagePath('privacy-policy')} target="_blank" rel="noopener noreferrer" className="ds-inline-link">
                    {t('guidelinesModal.privacyPolicy')}
                  </a>
                  .
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <Checkbox isSelected={termsAgreed} onChange={setTermsAgreed} />
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                  {t('guidelinesModal.agreeToThePrefix')}{' '}
                  <a href={publicPagePath('terms-and-conditions')} target="_blank" rel="noopener noreferrer" className="ds-inline-link">
                    {t('guidelinesModal.termsOfService')}
                  </a>{' '}
                  {t('guidelinesModal.liabilityNote')}
                </span>
              </label>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)} style={{ visibility: step > 0 ? 'visible' : 'hidden' }}>
            {t('guidelinesModal.back')}
          </Button>
          {!onAgreementStep ? (
            <PrimaryButton onClick={() => setStep((s) => s + 1)}>
              {onLastRule ? t('guidelinesModal.continue') : t('guidelinesModal.next')}
            </PrimaryButton>
          ) : (
            <PrimaryButton disabled={!agreed || isAgreeing} onClick={onAgree}>
              {isAgreeing ? t('guidelinesModal.saving') : t('guidelinesModal.agreeAndContinue')}
            </PrimaryButton>
          )}
        </div>
      </div>
    </Modal>
  )
}

interface Member {
  userId: string
  label: string
  initials: string
  bg: string
}

// Fixed dark text color on every avatar so initials stay readable against any pastel background.
const AVATAR_TEXT = '#2b2b2b'
const AVATAR_COLORS = [
  'oklch(90% 0.06 40)',
  'oklch(90% 0.06 210)',
  'oklch(90% 0.06 300)',
  'oklch(90% 0.06 145)',
  'oklch(90% 0.06 80)',
  'oklch(90% 0.06 260)',
  'oklch(90% 0.06 20)',
]

// First letter only (not two, the way a full-name avatar usually would)
// — this only ever reveals a first name, on purpose (see memberFor's own
// comment), so there's no last-name initial to pair it with anyway.
function initialsFor(displayName: string): string {
  return (displayName[0] ?? '?').toUpperCase()
}

// Roster members are anonymized by turn position by default — "Member
// 3", not a name (Charter §4) — *unless* that member has turned off
// "stay anonymous" in their profile, in which case `roster[].displayName`
// (resolved fresh by trpc-api on every session.getState call — see
// sessionShared.tsx's RosterEntry) carries their first name and is used
// instead. Never a persisted/cached value: since this is looked up live
// from the roster every time a label is needed (here), a message sent or
// a "joined" notice posted while someone was non-anonymous automatically
// shows as "Member N" again the moment they turn anonymity back on —
// there's nothing baked into the message/notice itself to un-reveal.
// `roster` order comes straight from the backend's turn_order, so the
// anonymous fallback label is stable across a session regardless.
function memberFor(userId: string, roster: RosterEntry[], myUserId: string | null): Member {
  if (userId === myUserId) {
    return { userId, label: 'You', initials: 'Y', bg: 'var(--accent-safe)' }
  }
  const entry = roster.find((r) => r.userId === userId)
  const n = (entry?.turnOrder ?? 0) + 1
  const bg = AVATAR_COLORS[(entry?.turnOrder ?? 0) % AVATAR_COLORS.length] as string
  if (entry?.displayName) {
    return { userId, label: entry.displayName, initials: initialsFor(entry.displayName), bg }
  }
  return { userId, label: `Member ${n}`, initials: `M${n}`, bg }
}

// `online` is presence (currently connected — see SessionState.onlineUserIds),
// separate from `ringed` (currently holds the turn) — a member can be
// either, both, or neither, so this is a distinct visual signal (a small
// dot), not a variant of the ring.
function MemberAvatar({
  member,
  size = 32,
  ringed = false,
  online = false,
}: {
  member: Member
  size?: number
  ringed?: boolean
  online?: boolean
}) {
  const { t } = useTranslation('session')
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <Avatar
        label={member.label}
        title={online ? t('member.onlineNow', { name: member.label }) : member.label}
        style={{
          width: size,
          height: size,
          minWidth: size,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size <= 28 ? 10 : 11,
          fontWeight: 'var(--font-weight-bold)' as unknown as number,
          background: member.bg,
          color: AVATAR_TEXT,
          boxShadow: ringed ? '0 0 0 2px var(--surface-raised), 0 0 0 4px var(--accent-safe)' : 'none',
        }}
      >
        {member.initials}
      </Avatar>
      {online && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: size <= 28 ? 8 : 9,
            height: size <= 28 ? 8 : 9,
            borderRadius: '50%',
            background: 'var(--accent-safe)',
            boxShadow: '0 0 0 2px var(--surface-raised)',
          }}
        />
      )}
    </div>
  )
}

// Memoized so a keystroke in the composer (which lives in the same
// SessionCenterPanel and re-renders it every time) doesn't force every
// already-rendered message to redo its `formatMessageTimestamp` work
// (a fresh Intl.DateTimeFormat construction each call) — only a message
// whose own props actually changed re-renders.
const FlagIcon = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 3v18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M5 4h13l-3 4 3 4H5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// A held-back (flag) or crisis message is only ever delivered back to its
// own author — see trpc-api's listMessages. `isOwn` is therefore already
// implied whenever moderationStatus isn't 'pass', but this still gates on
// it explicitly rather than assuming that invariant holds forever.
// 'reviewed_pass' is intentionally styled the same as flag/crisis, not
// like a normal 'pass' message — it's a human override, not the
// classifier's own verdict, and still only this user's own eyes see it.
const MessageRow = memo(function MessageRow({
  message,
  member,
  isOwn,
  timeZone,
  onReportFalsePositive,
  isReported,
  t,
}: {
  message: ChatMessage
  member: Member
  isOwn: boolean
  timeZone: string
  onReportFalsePositive: (messageId: string) => void
  isReported: boolean
  t: TFunction<'session'>
}) {
  const isWithheld = isOwn && message.moderationStatus !== 'pass'
  const alreadyReported = isReported || message.falsePositiveReportedAt !== null

  return (
    <div style={{ display: 'flex', gap: 10, maxWidth: 560 }}>
      <MemberAvatar member={member} size={32} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{member.label}</span>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', opacity: 0.7 }}>
            {formatMessageTimestamp(message.createdAt, timeZone)}
          </span>
          {isWithheld && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--signal-urgent)' }}>
              {t('composer.onlyYouCanSeeThis')}
            </span>
          )}
        </span>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <div
            style={{
              background: isWithheld ? 'var(--signal-urgent-surface)' : isOwn ? 'var(--accent-safe-surface)' : 'var(--surface-raised)',
              border: isWithheld ? '0.5px solid var(--signal-urgent)' : '0.5px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-primary)',
              lineHeight: 'var(--line-height-base)',
              // Plain text content collapses newlines by default —
              // without this a Shift+Enter-composed message reads
              // back as one run-on line.
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontStyle: alreadyReported ? 'italic' : undefined,
            }}
          >
            {/* Once reported, the original text is replaced (not just
                the button disabled) — a visible, unmistakable "we're on
                it" signal, so there's no reason to submit the same
                report again. */}
            {alreadyReported ? t('composer.falsePositiveReportedNotice') : message.body}
          </div>
          {isWithheld && !alreadyReported && (
            <IconButton
              icon={FlagIcon}
              label={t('composer.reportFalsePositive')}
              variant="urgent"
              onClick={() => onReportFalsePositive(message.id)}
            />
          )}
        </div>
      </div>
    </div>
  )
})

// A "member joined" system-message line, rendered inline in the message
// timeline the way Microsoft Teams does — left-aligned with a timestamp,
// muted, no avatar/bubble — in place of the toast this replaced. Backed
// by a real persisted `type: 'system'` message row (see
// messageRepository.ts's `type` column), so it survives a refresh and
// interleaves correctly with real messages by timestamp automatically —
// see the render loop below, no separate merge needed.
const JoinEventRow = memo(function JoinEventRow({
  message,
  member,
  timeZone,
  t,
}: {
  message: ChatMessage
  member: Member
  timeZone: string
  t: TFunction<'session'>
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 0' }}>
      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{t('composer.memberJoined', { name: member.label })}</span>
      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', opacity: 0.7 }}>
        {formatMessageTimestamp(message.createdAt, timeZone)}
      </span>
    </div>
  )
})

// Matches pages/start/shared.tsx's Chip pattern (pill-style choice control), reused here so
// the "who is this about" picker looks consistent with the rest of the product.
function chipStyle(active: boolean): React.CSSProperties {
  return {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    border: `1px solid ${active ? 'var(--accent-safe)' : 'var(--border-subtle)'}`,
    borderRadius: 'var(--radius-full)',
    padding: '6px 14px',
    background: active ? 'var(--accent-safe-surface)' : 'var(--surface-app)',
    color: active ? 'var(--accent-safe)' : 'var(--text-primary)',
    fontFamily: 'var(--font-family-base)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: (active ? 'var(--font-weight-bold)' : 'var(--font-weight-regular)') as unknown as number,
  }
}

// Replaces what used to be an inline <Alert> above the compose box (see
// git history) — a modal reads as more deliberate/private for something
// this sensitive, and gives the resource list room to breathe instead of
// being squeezed into a thin banner. Dismissable (Esc/click-outside,
// same as ReportSessionModal below) — the user isn't trapped in it.
// `resource.message`/`resources` come straight from the backend
// (crisisEscalationService.ts's buildCrisisResource, deliberately kept
// untranslated for now — see that file's own comment on why hotline
// data stays as-is rather than routed through i18n); only this modal's
// own chrome (title, the explanatory note below) is translated.
function CrisisModal({
  resource,
  onOpenChange,
}: {
  resource: CrisisResource
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('session')

  return (
    <Modal isOpen onOpenChange={onOpenChange} title={t('crisisModal.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', lineHeight: 'var(--line-height-base)' }}>
          {resource.message}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {resource.resources.map((r) => (
            <div
              key={r.name}
              style={{
                border: '0.5px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3) var(--space-4)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              <div style={{ fontWeight: 'var(--font-weight-medium)' as unknown as number, color: 'var(--text-primary)' }}>{r.name}</div>
              <div style={{ color: 'var(--text-secondary)' }}>
                {r.phone}
                {r.url && (
                  <>
                    {' · '}
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="ds-inline-link">
                      {r.url}
                    </a>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <p style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', lineHeight: 'var(--line-height-base)' }}>
          {t('crisisModal.notice')}
        </p>
      </div>
    </Modal>
  )
}

function ReportSessionModal({
  isOpen,
  onOpenChange,
  sessionId,
  reportable,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  reportable: Member[]
}) {
  const { t } = useTranslation('session')
  const [text, setText] = useState('')
  const [aboutIds, setAboutIds] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function toggleAbout(id: string) {
    setAboutIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]))
  }

  // Reset per-open, not just on a successful submit — reopening the
  // modal after a cancel (or a failed attempt the user gave up on)
  // should never show a stale error from a previous attempt.
  function handleOpenChange(open: boolean) {
    if (open) setSubmitError(null)
    onOpenChange(open)
  }

  async function handleSubmit(close: () => void) {
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await submitSessionReport(sessionId, aboutIds, text.trim())
      const about = reportable
        .filter((m) => aboutIds.includes(m.userId))
        .map((m) => m.label)
        .join(', ')
      setText('')
      setAboutIds([])
      addToast(t('reportModal.submitted', { about }), { variant: 'safe' })
      close()
    } catch {
      setSubmitError(t('reportModal.submitError'))
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={handleOpenChange} title={t('reportModal.title')}>
      {(close) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--line-height-base)' }}>
            {t('reportModal.description')}
          </p>

          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as unknown as number, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
              {t('reportModal.whoIsThisAbout')}{' '}
              <span style={{ color: 'var(--text-secondary)', fontWeight: 'var(--font-weight-regular)' as unknown as number }}>
                {t('reportModal.selectAllThatApply')}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {reportable.length === 0 && (
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{t('reportModal.nobodyElseJoined')}</span>
              )}
              {reportable.map((m) => (
                <button key={m.userId} type="button" onClick={() => toggleAbout(m.userId)} style={chipStyle(aboutIds.includes(m.userId))}>
                  <MemberAvatar member={m} size={20} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <Textarea
            label={t('reportModal.whatsGoingOn')}
            placeholder={t('reportModal.describePlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
          />
          {submitError && <Alert variant="urgent">{submitError}</Alert>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="ghost" onClick={close} isDisabled={isSubmitting}>
              {t('reportModal.cancel')}
            </Button>
            <Button
              variant="urgent"
              isPending={isSubmitting}
              isDisabled={!text.trim() || aboutIds.length === 0}
              onPress={() => handleSubmit(close)}
            >
              {t('reportModal.submit')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function NewSessionModal({ isOpen, onOpenChange, onJoined }: { isOpen: boolean; onOpenChange: (open: boolean) => void; onJoined: (sessionId: string) => void }) {
  const { t } = useTranslation('session')
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('newSessionModal.title')}>
      <Tabs>
        <TabList aria-label={t('newSessionModal.tabListLabel')}>
          <Tab id="join">{t('newSessionModal.joinTab')}</Tab>
          <Tab id="create">{t('newSessionModal.createTab')}</Tab>
        </TabList>
        <TabPanel id="join">
          <StartJoinPage
            embedded
            onBack={() => onOpenChange(false)}
            onComplete={(sessionId) => {
              onOpenChange(false)
              onJoined(sessionId)
            }}
          />
        </TabPanel>
        <TabPanel id="create">
          <StartNewPage
            embedded
            onBack={() => onOpenChange(false)}
            onComplete={(sessionId) => {
              onOpenChange(false)
              onJoined(sessionId)
            }}
          />
        </TabPanel>
      </Tabs>
    </Modal>
  )
}

type AccountModalSection = 'preferences' | 'profile' | 'privacy'

const SYSTEM_TIMEZONE_KEY = 'system'
const SYSTEM_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const SUPPORTED_TIME_ZONES = Intl.supportedValuesOf('timeZone').sort((a, b) => a.localeCompare(b))

// "GMT+1"-style short offset per zone, computed once against today's date
// (not per-render — formatting ~400 zones on every keystroke would be
// wasteful) so the open dropdown can show the hour difference next to
// each name — the raw IANA name alone ("America/New_York") doesn't tell
// a user how far off their day that actually is.
const TIME_ZONE_OFFSETS: Record<string, string> = Object.fromEntries(
  SUPPORTED_TIME_ZONES.map((tz) => [
    tz,
    new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')
      ?.value ?? '',
  ]),
)

// Two-column account modal — a left-hand nav (Preferences / Profile /
// Settings / Privacy & data, plus Log out as a separate exit action rather
// than a section with its own content) and a right-hand panel that swaps
// based on the selected section. Replaces the old "⋯" dropdown menu, which
// only ever held a single "Log out" item.
// Every field the Profile/Preferences form's shared save button submits —
// used to snapshot "what's currently saved" so the button can tell
// whether the draft actually differs from it (see AccountModal's
// savedSnapshot/isDirty below), not just whether the required fields
// happen to be filled in.
interface ProfileDraft {
  firstName: string
  lastName: string
  gender: Key | null
  country: Key | null
  mobile: string
  stayAnonymous: boolean
  language: SupportedLanguage
  timezone: string | null
  trainingConsent: boolean
}

function draftsEqual(a: ProfileDraft, b: ProfileDraft): boolean {
  return (
    a.firstName === b.firstName &&
    a.lastName === b.lastName &&
    a.gender === b.gender &&
    a.country === b.country &&
    a.mobile === b.mobile &&
    a.stayAnonymous === b.stayAnonymous &&
    a.language === b.language &&
    a.timezone === b.timezone &&
    a.trainingConsent === b.trainingConsent
  )
}

// Shared by both the Profile and Preferences sections (they save the same
// underlying draft — see AccountModal's handleSaveProfile). Shows the
// "Saved" confirmation inline next to the button itself instead of as a
// toast — `justSaved && !isDirty` is what makes it disappear the instant
// the draft diverges from what was actually saved again, without having
// to hook every individual field's onChange to clear a flag.
function SaveProfileRow({
  isPending,
  canSubmit,
  justSaved,
  isDirty,
  savedLabel,
  saveLabel,
  onSave,
}: {
  isPending: boolean
  canSubmit: boolean
  justSaved: boolean
  isDirty: boolean
  savedLabel: string
  saveLabel: string
  onSave: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 'var(--space-2)' }}>
      {justSaved && !isDirty && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--accent-safe)' }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {savedLabel}
        </span>
      )}
      <Button variant="safe" className="dash-account-modal__save-btn" isPending={isPending} isDisabled={!canSubmit} onPress={onSave}>
        {saveLabel}
      </Button>
    </div>
  )
}

function AccountModal({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, i18n } = useTranslation('common')
  const { t: dt } = useTranslation('session')
  const [section, setSection] = useState<AccountModalSection>('profile')
  // Mobile-only "step 2" — see the CSS media query in SessionPage.css.
  // On desktop both the nav and the section content are visible at once,
  // and this stays false/unused. Reset to false (step 1: nav list) every
  // time the modal opens, alongside the other reset effect below.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const { profile, profileLoading, profileError, refetch } = usePreferences()

  // Draft fields for the editable Profile/Preferences form, seeded from
  // `profile` below. Kept separate from `profile` itself so a half-edited
  // form doesn't affect anything else reading `profile`, and so a failed
  // save leaves the user's in-progress edits in place rather than
  // reverting them.
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editGender, setEditGender] = useState<Key | null>(null)
  const [editCountry, setEditCountry] = useState<Key | null>(null)
  const [editMobile, setEditMobile] = useState('')
  const [editStayAnonymous, setEditStayAnonymous] = useState(true)
  const [editLanguage, setEditLanguage] = useState<SupportedLanguage>('en')
  const [editTimezone, setEditTimezone] = useState<string | null>(null)
  // Consent to AI training use — defaults false (not consented, matches
  // the DB column default) until the real profile loads.
  const [editTrainingConsent, setEditTrainingConsent] = useState(false)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [saveProfileError, setSaveProfileError] = useState<string | null>(null)
  // What's actually saved right now — diffed against the live draft below
  // to decide whether the Save button has anything to do. Set both by the
  // re-seed effect (on load/reopen) and by a successful save itself, so
  // the button goes right back to disabled once the draft it just
  // submitted becomes the new "saved" baseline.
  const [savedSnapshot, setSavedSnapshot] = useState<ProfileDraft | null>(null)
  // Shows the inline "Saved" confirmation next to the button in place of
  // a toast — cleared implicitly the moment the draft diverges from
  // savedSnapshot again (see the `justSaved && !isDirty` check at each
  // render site below), not by hooking every individual field's onChange.
  const [justSaved, setJustSaved] = useState(false)

  // "Download your data" (GDPR Article 20) — mirrors
  // DataExportRequestSummary from trpc-api's dataExportRequestService.ts.
  // null means "hasn't fetched this open yet"; an empty array means
  // "fetched, nothing requested yet" — both show the request button, only
  // the former also withholds the list itself while loading.
  interface ExportRequestSummary {
    id: string
    status: 'pending' | 'processing' | 'ready' | 'failed' | 'expired'
    requestedAt: string
    expiresAt: string | null
  }
  const [exportRequests, setExportRequests] = useState<ExportRequestSummary[] | null>(null)
  const [isRequestingExport, setIsRequestingExport] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // Which row's Download button is mid-request — a fresh, short-lived
  // token is minted on every click (never reused/cached), so this is
  // strictly a per-click pending state, not tied to the request's own
  // 'ready' status.
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // "Delete account" (GDPR Article 17) — immediate, no grace period (see
  // the plan this shipped with). Type-to-confirm friction before the
  // actual irreversible call, same pattern as the registration page's
  // training-consent confirm modal.
  const [deleteAccountConfirmOpen, setDeleteAccountConfirmOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null)

  const currentDraft: ProfileDraft = {
    firstName: editFirstName,
    lastName: editLastName,
    gender: editGender,
    country: editCountry,
    mobile: editMobile,
    stayAnonymous: editStayAnonymous,
    language: editLanguage,
    timezone: editTimezone,
    trainingConsent: editTrainingConsent,
  }
  const isDirty = savedSnapshot !== null && !draftsEqual(currentDraft, savedSnapshot)

  // Reset to the default tab/step and clear any stale save error every
  // time the modal opens — mirrors the old fetch-driven effect's reset,
  // now that the fetch itself lives one level up in PreferencesProvider.
  useEffect(() => {
    if (!isOpen) return
    setSection('profile')
    setMobileDetailOpen(false)
    setSaveProfileError(null)
    setJustSaved(false)
    setExportRequests(null)
    setExportError(null)
    setDeleteAccountConfirmOpen(false)
    setDeleteConfirmText('')
    setDeleteAccountError(null)
  }, [isOpen])

  // Re-seeds the draft fields whenever a freshly (re)loaded profile shows
  // up while the modal is open — on first open once the shared fetch
  // resolves, and again after a save's refetch() — so an abandoned edit
  // never survives a close/reopen, same as the old per-open fetch did.
  // Also (re)establishes savedSnapshot from this same data, so the Save
  // button starts out disabled (nothing dirty yet) whenever the form is
  // freshly (re)seeded, not just right after this component's own save.
  useEffect(() => {
    if (!isOpen || !profile) return
    const snapshot: ProfileDraft = {
      firstName: profile.firstName,
      lastName: profile.lastName,
      gender: profile.gender,
      country: profile.country,
      mobile: profile.mobileNumber,
      stayAnonymous: profile.stayAnonymous,
      language: (profile.language as SupportedLanguage | null) ?? detectDefaultLanguage(),
      timezone: profile.timezone,
      trainingConsent: profile.trainingConsent,
    }
    setEditFirstName(snapshot.firstName)
    setEditLastName(snapshot.lastName)
    setEditGender(snapshot.gender)
    setEditCountry(snapshot.country)
    setEditMobile(snapshot.mobile)
    setEditStayAnonymous(snapshot.stayAnonymous)
    setEditLanguage(snapshot.language)
    setEditTimezone(snapshot.timezone)
    setEditTrainingConsent(snapshot.trainingConsent)
    setSavedSnapshot(snapshot)
  }, [isOpen, profile])

  async function fetchExportRequests() {
    try {
      const res = await fetch('/api/trpc/auth.getDataExportStatus')
      if (!res.ok) return
      const body = (await res.json()) as { result: { data: ExportRequestSummary[] } }
      // Already sorted newest-first by the backend (requestedAt desc).
      setExportRequests(body.result.data)
    } catch {
      // Silent — this is a background status refresh, not a
      // user-initiated action; a failed poll just tries again next tick.
    }
  }

  // Fetch once when the Privacy section becomes visible, and again on
  // every subsequent visit — a request made in an earlier visit to this
  // modal (or a different tab) should still show up.
  useEffect(() => {
    if (!isOpen || section !== 'privacy') return
    void fetchExportRequests()
  }, [isOpen, section])

  // Lightweight polling while any request is in flight on the worker side
  // — this is the ONLY way the UI learns it finished, since trpc-api
  // itself has no way to push that update (see
  // dataExportRequestService.ts's doc comment on why the worker is
  // fully decoupled). Stops itself once nothing is pending/processing.
  const hasInFlightExport = exportRequests?.some((r) => r.status === 'pending' || r.status === 'processing') ?? false
  useEffect(() => {
    if (!isOpen || section !== 'privacy' || !hasInFlightExport) return
    const interval = setInterval(() => void fetchExportRequests(), 4000)
    return () => clearInterval(interval)
  }, [isOpen, section, hasInFlightExport])

  async function handleRequestExport() {
    setExportError(null)
    setIsRequestingExport(true)
    try {
      const res = await fetch('/api/trpc/auth.requestDataExport', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('request failed')
      const body = (await res.json()) as { result: { data: { id: string; requestedAt: string } } }
      setExportRequests((prev) => [
        { id: body.result.data.id, status: 'pending', requestedAt: body.result.data.requestedAt, expiresAt: null },
        ...(prev ?? []),
      ])
    } catch {
      setExportError(dt('accountModal.dataExportRequestFailed'))
    } finally {
      setIsRequestingExport(false)
    }
  }

  // Mints a fresh, short-lived (1 day) download token on every click —
  // never reuses or caches a URL, matching trpc-api's own design (see
  // authRouter.ts's createExportDownloadToken). A direct navigation, not
  // target="_blank": the proxy route's Content-Disposition: attachment
  // response makes the browser download it in place rather than opening
  // a viewer tab.
  async function handleDownload(requestId: string) {
    setExportError(null)
    setDownloadingId(requestId)
    try {
      const res = await fetch('/api/trpc/auth.createExportDownloadToken', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      })
      if (!res.ok) throw new Error('download failed')
      const body = (await res.json()) as { result: { data: { url: string } } }
      window.location.href = body.result.data.url
    } catch {
      setExportError(dt('accountModal.dataExportDownloadFailed'))
    } finally {
      setDownloadingId(null)
    }
  }

  async function handleDeleteAccount() {
    setDeleteAccountError(null)
    setIsDeletingAccount(true)
    try {
      const res = await fetch('/api/trpc/auth.deleteAccount', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('delete failed')
      window.location.href = landingPath()
    } catch {
      setDeleteAccountError(dt('accountModal.deleteAccountFailed'))
      setIsDeletingAccount(false)
    }
  }

  const canSaveProfile =
    editFirstName.trim() !== '' &&
    editLastName.trim() !== '' &&
    editGender != null &&
    editCountry != null &&
    editMobile.trim() !== ''
  // Disabled unless there's both something valid to submit AND something
  // that actually differs from what's already saved — the "keep it
  // disabled until something changed" requirement.
  const canSubmitProfile = canSaveProfile && isDirty

  // Reuses auth.completeProfile — it's an upsert keyed on user_id (see
  // userProfileRepository.ts's own doc comment: "resubmitting the
  // registration form... replaces the previous profile rather than
  // erroring"), already designed to double as an edit path, not just the
  // one-time RegisterPage.tsx flow. Deliberately doesn't re-ask for terms
  // agreement here — that's a one-time consent gate at registration, not
  // something routine edits should have to re-clear every time. Shared by
  // both the Profile and Preferences sections' Save buttons: it's a
  // full-replace upsert either way (see userProfileRepository.ts), so
  // saving from either tab sends every current draft field, not just the
  // ones in that tab.
  async function handleSaveProfile() {
    if (!canSubmitProfile) return
    setSaveProfileError(null)
    setJustSaved(false)
    setIsSavingProfile(true)
    // Trimmed once, reused both for the request body and for the new
    // savedSnapshot/draft baseline below — .trim() on submit must never
    // leave the button looking dirty again just because the raw draft
    // still has the untrimmed whitespace the server won't have stored.
    const trimmed: ProfileDraft = {
      firstName: editFirstName.trim(),
      lastName: editLastName.trim(),
      gender: editGender,
      country: editCountry,
      mobile: editMobile.trim(),
      stayAnonymous: editStayAnonymous,
      language: editLanguage,
      timezone: editTimezone,
      trainingConsent: editTrainingConsent,
    }
    try {
      const res = await fetch('/api/trpc/auth.completeProfile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstName: trimmed.firstName,
          lastName: trimmed.lastName,
          gender: String(trimmed.gender),
          country: String(trimmed.country),
          mobileNumber: trimmed.mobile,
          stayAnonymous: trimmed.stayAnonymous,
          language: trimmed.language,
          timezone: trimmed.timezone,
          trainingConsent: trimmed.trainingConsent,
        }),
      })
      if (!res.ok) throw new Error('error')
      // Applied here too, not just via PreferencesProvider's effect off
      // the refetched profile below — that effect fires after the refetch
      // resolves, which would otherwise apply the change in the language
      // the user just switched away from.
      if (editLanguage !== i18n.language) await i18n.changeLanguage(editLanguage)
      setEditFirstName(trimmed.firstName)
      setEditLastName(trimmed.lastName)
      setEditMobile(trimmed.mobile)
      setSavedSnapshot(trimmed)
      setJustSaved(true)
      refetch()
    } catch {
      setSaveProfileError(t('errors.saveFailed'))
    } finally {
      setIsSavingProfile(false)
    }
  }

  const navItems: { id: AccountModalSection; label: string }[] = [
    { id: 'profile', label: t('nav.profile') },
    { id: 'preferences', label: t('nav.preferences') },
    { id: 'privacy', label: t('nav.privacy') },
  ]

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('account.title')} className="dash-account-modal">
      <div className="dash-account-modal__viewport">
        <div className={['dash-account-modal__body', mobileDetailOpen && 'dash-account-modal__body--detail'].filter(Boolean).join(' ')}>
          <div className="dash-account-modal__nav">
            <div className="dash-account-modal__nav-title">{t('account.title')}</div>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="dash-account-modal__nav-item"
                aria-current={section === item.id}
                onClick={() => {
                  setSection(item.id)
                  setMobileDetailOpen(true)
                }}
              >
                {item.label}
              </button>
            ))}
            <div style={{ marginTop: 'auto', paddingTop: 'var(--space-3)', borderTop: '0.5px solid var(--border-subtle)' }}>
              <button
                type="button"
                className="dash-account-modal__nav-item dash-account-modal__nav-item--urgent"
                onClick={() => void handleLogout(t)}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 2H3.5A1.5 1.5 0 002 3.5v9A1.5 1.5 0 003.5 14H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M10.5 11l3-3-3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.5 8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t('nav.logOut')}
              </button>
            </div>
          </div>
          <div className="dash-account-modal__content">
            <button type="button" className="dash-account-modal__back" onClick={() => setMobileDetailOpen(false)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {dt('accountModal.back')}
            </button>
            {section === 'preferences' && (
            <>
              <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as unknown as number }}>
                {t('nav.preferences')}
              </div>
              {profileLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton width="60%" height={14} />
                  <Skeleton width="40%" height={14} />
                </div>
              )}
              {!profileLoading && profileError && <Alert variant="urgent">{profileError}</Alert>}
              {!profileLoading && !profileError && !profile && (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                  {dt('accountModal.preferencesUnavailable')}
                </div>
              )}
              {!profileLoading && !profileError && profile && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{dt('accountModal.language')}</div>
                    <Select
                      aria-label={dt('accountModal.language')}
                      selectedKey={editLanguage}
                      onSelectionChange={(key) => setEditLanguage(key as SupportedLanguage)}
                    >
                      {SUPPORTED_LANGUAGES.map((l) => (
                        <SelectItem key={l.code} id={l.code}>
                          {l.nativeName}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{dt('accountModal.timezone')}</div>
                    <Select
                      aria-label={dt('accountModal.timezone')}
                      selectedKey={editTimezone ?? SYSTEM_TIMEZONE_KEY}
                      onSelectionChange={(key) => setEditTimezone(key === SYSTEM_TIMEZONE_KEY ? null : String(key))}
                    >
                      <SelectItem id={SYSTEM_TIMEZONE_KEY} textValue={dt('accountModal.systemDefaultShort')}>
                        {dt('accountModal.systemDefault', { zone: SYSTEM_TIME_ZONE, offset: TIME_ZONE_OFFSETS[SYSTEM_TIME_ZONE] ?? '' })}
                      </SelectItem>
                      {SUPPORTED_TIME_ZONES.map((tz) => (
                        <SelectItem key={tz} id={tz} textValue={tz}>
                          {`${tz} (${TIME_ZONE_OFFSETS[tz]})`}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>

                  {/* Appearance applies immediately via toggleTheme — it isn't
                      part of the draft/save flow the rest of this section
                      uses, just co-located here since Preferences absorbed
                      the old standalone Settings tab. */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                    <div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{dt('accountModal.appearance')}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{dt('accountModal.appearanceHint')}</div>
                    </div>
                    <Switch isSelected={theme === 'dark'} onChange={toggleTheme} />
                  </div>

                  {saveProfileError && <Alert variant="urgent">{saveProfileError}</Alert>}

                  <SaveProfileRow
                    isPending={isSavingProfile}
                    canSubmit={canSubmitProfile}
                    justSaved={justSaved}
                    isDirty={isDirty}
                    savedLabel={t('actions.saved')}
                    saveLabel={t('actions.saveChanges')}
                    onSave={() => void handleSaveProfile()}
                  />
                </div>
              )}
            </>
          )}
          {section === 'profile' && (
            <>
              <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as unknown as number }}>
                {dt('accountModal.profile')}
              </div>
              {profileLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton width="60%" height={14} />
                  <Skeleton width="40%" height={14} />
                  <Skeleton width="50%" height={14} />
                </div>
              )}
              {!profileLoading && profileError && <Alert variant="urgent">{profileError}</Alert>}
              {!profileLoading && !profileError && !profile && (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{dt('accountModal.profileUnavailable')}</div>
              )}
              {!profileLoading && !profileError && profile && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 140px' }}>
                      <TextField
                        className="dash-account-modal__field"
                        label={dt('accountModal.firstName')}
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        autoComplete="given-name"
                      />
                    </div>
                    <div style={{ flex: '1 1 140px' }}>
                      <TextField
                        className="dash-account-modal__field"
                        label={dt('accountModal.lastName')}
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        autoComplete="family-name"
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 140px' }}>
                      <Select
                        className="dash-account-modal__field"
                        label={dt('accountModal.gender')}
                        placeholder={dt('accountModal.genderPlaceholder')}
                        selectedKey={editGender}
                        onSelectionChange={setEditGender}
                      >
                        {GENDERS.map((g) => (
                          <SelectItem key={g} id={g}>
                            {dt(`accountModal.gender_${g}`)}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 140px' }}>
                      <Select
                        className="dash-account-modal__field"
                        label={dt('accountModal.country')}
                        placeholder={dt('accountModal.countryPlaceholder')}
                        selectedKey={editCountry}
                        onSelectionChange={setEditCountry}
                      >
                        {COUNTRIES.map((c) => (
                          <SelectItem key={c.code} id={c.code}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                    <div style={{ flex: '1 1 140px' }}>
                      <TextField
                        className="dash-account-modal__field"
                        label={dt('accountModal.mobileNumber')}
                        type="tel"
                        value={editMobile}
                        onChange={(e) => setEditMobile(e.target.value)}
                        autoComplete="tel"
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: -8 }}>
                    {dt('accountModal.mobileHint')}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                    <div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{dt('accountModal.stayAnonymous')}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{dt('accountModal.stayAnonymousHint')}</div>
                    </div>
                    <Switch isSelected={editStayAnonymous} onChange={setEditStayAnonymous} />
                  </div>

                  {saveProfileError && <Alert variant="urgent">{saveProfileError}</Alert>}

                  <SaveProfileRow
                    isPending={isSavingProfile}
                    canSubmit={canSubmitProfile}
                    justSaved={justSaved}
                    isDirty={isDirty}
                    savedLabel={t('actions.saved')}
                    saveLabel={t('actions.saveChanges')}
                    onSave={() => void handleSaveProfile()}
                  />
                </div>
              )}
            </>
          )}
          {section === 'privacy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as unknown as number }}>
                {t('nav.privacy')}
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', lineHeight: 'var(--line-height-base)' }}>
                {dt('accountModal.privacyNote')}
              </div>
              <a
                href={publicPagePath('privacy-policy')}
                target="_blank"
                rel="noopener noreferrer"
                className="ds-inline-link"
                style={{ fontSize: 'var(--font-size-sm)' }}
              >
                {dt('accountModal.readFullPrivacyPolicy')}
              </a>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{dt('accountModal.trainingConsent')}</span>
                    <DialogTrigger>
                      <IconButton
                        icon="!"
                        label={dt('accountModal.trainingConsentInfoLabel')}
                        style={{ width: 20, height: 20, fontSize: 'var(--font-size-xs)' }}
                      />
                      <Popover className="ds-tooltip" placement="top">
                        <Dialog style={{ outline: 'none' }}>{dt('accountModal.trainingConsentInfo')}</Dialog>
                      </Popover>
                    </DialogTrigger>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{dt('accountModal.trainingConsentHint')}</div>
                </div>
                <Switch isSelected={editTrainingConsent} onChange={setEditTrainingConsent} />
              </div>

              {saveProfileError && <Alert variant="urgent">{saveProfileError}</Alert>}

              <SaveProfileRow
                isPending={isSavingProfile}
                canSubmit={canSubmitProfile}
                justSaved={justSaved}
                isDirty={isDirty}
                savedLabel={t('actions.saved')}
                saveLabel={t('actions.saveChanges')}
                onSave={() => void handleSaveProfile()}
              />

              <div style={{ borderTop: '0.5px solid var(--border-subtle)', paddingTop: 'var(--space-4)' }}>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                  {dt('accountModal.dataExport')}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 10 }}>
                  {dt('accountModal.dataExportHint')}
                </div>

                {exportError && <Alert variant="urgent">{exportError}</Alert>}

                <Button
                  variant="secondary"
                  isPending={isRequestingExport}
                  isDisabled={hasInFlightExport}
                  onPress={() => void handleRequestExport()}
                >
                  {dt('accountModal.dataExportRequest')}
                </Button>

                {exportRequests && exportRequests.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                    {exportRequests.map((request) => (
                      <div
                        key={request.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '8px 0',
                          borderTop: '0.5px solid var(--border-subtle)',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                            {new Date(request.requestedAt).toLocaleDateString()}
                          </div>
                          {request.status === 'ready' && request.expiresAt ? (
                            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                              {dt('accountModal.dataExportExpiresOn', { date: new Date(request.expiresAt).toLocaleDateString() })}
                            </div>
                          ) : request.status === 'failed' ? (
                            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--signal-urgent)' }}>
                              {dt('accountModal.dataExportFailed')}
                            </div>
                          ) : request.status === 'expired' ? (
                            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                              {dt('accountModal.dataExportExpired')}
                            </div>
                          ) : null}
                        </div>

                        {request.status === 'ready' ? (
                          <Button
                            variant="ghost"
                            isPending={downloadingId === request.id}
                            onPress={() => void handleDownload(request.id)}
                          >
                            {dt('accountModal.dataExportDownload')}
                          </Button>
                        ) : request.status === 'pending' || request.status === 'processing' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Spinner size={16} />
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                              {dt('accountModal.dataExportPreparing')}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ borderTop: '0.5px solid var(--border-subtle)', paddingTop: 'var(--space-4)' }}>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                  {dt('accountModal.deleteAccount')}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 10 }}>
                  {dt('accountModal.deleteAccountHint')}
                </div>
                <Button variant="urgent" onPress={() => setDeleteAccountConfirmOpen(true)}>
                  {dt('accountModal.deleteAccountButton')}
                </Button>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={deleteAccountConfirmOpen}
        onOpenChange={(open) => {
          setDeleteAccountConfirmOpen(open)
          if (!open) {
            setDeleteConfirmText('')
            setDeleteAccountError(null)
          }
        }}
        title={dt('accountModal.deleteAccountConfirmTitle')}
      >
        {(close) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <Alert variant="urgent">{dt('accountModal.deleteAccountConfirmBody')}</Alert>
            <TextField
              label={dt('accountModal.deleteAccountConfirmLabel')}
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
            />
            {deleteAccountError && <Alert variant="urgent">{deleteAccountError}</Alert>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button variant="secondary" onPress={close}>
                {dt('accountModal.deleteAccountConfirmCancel')}
              </Button>
              <Button
                variant="urgent"
                isPending={isDeletingAccount}
                isDisabled={deleteConfirmText !== 'DELETE'}
                onPress={() => void handleDeleteAccount()}
              >
                {dt('accountModal.deleteAccountConfirmAccept')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Modal>
  )
}

function formatScheduledAt(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone })
}

// yyyy-mm-dd in the given zone, for a same-day comparison that's actually
// correct in that zone — comparing local Date getters (getFullYear/
// getMonth/getDate) would silently use the browser's own zone instead
// whenever `timeZone` is an explicit preference that differs from it.
function dateKeyInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

// Time-only for a message sent earlier today (the common case in a live
// round) — the date would just be visual noise. Anything older (a
// transcript revisited on a later day) gets the date too, since "3:45 PM"
// alone stops being unambiguous once it's not today.
function formatMessageTimestamp(iso: string, timeZone: string): string {
  const sent = new Date(iso)
  const now = new Date()
  const isToday = dateKeyInZone(sent, timeZone) === dateKeyInZone(now, timeZone)
  const time = sent.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone })
  if (isToday) return time
  const date = sent.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone })
  return `${date}, ${time}`
}

// Returns null for the "Anonymous by default" case — that's true of
// every session and not worth a permanent line in the header; only
// return text when it's actually telling the user something (ended, or
// a future start time).
function statusSubtitle(summary: SessionSummary, timeZone: string, t: TFunction<'session'>): string | null {
  if (summary.status === 'completed' || summary.status === 'cancelled') return t('status.ended')
  if (summary.status === 'active') return null
  if (summary.scheduledAt) return t('status.startsAt', { time: formatScheduledAt(summary.scheduledAt, timeZone) })
  return null
}

function emptyStateText(summary: SessionSummary, t: TFunction<'session'>): string {
  if (summary.status === 'completed' || summary.status === 'cancelled') {
    return t('emptyState.ended')
  }
  if (summary.status === 'forming') {
    return t('emptyState.forming')
  }
  return t('emptyState.waitingForFirstMessage')
}

function DashboardSidebarSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} style={{ padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Skeleton width="70%" height={13} />
          <Skeleton width="45%" height={11} />
        </div>
      ))}
    </div>
  )
}

function RecentVisitsList({
  visits,
  activeId,
  search,
  onSelect,
}: {
  visits: RecentVisit[]
  activeId: string
  search: string
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation('session')
  const trimmed = search.trim()
  const { effectiveTimeZone } = usePreferences()
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const prevRectsRef = useRef(new Map<string, DOMRect>())

  // FLIP: when a session switch (or a search edit) reorders this list —
  // most visibly, the just-visited session jumping to the top — slide
  // each row from its previous position to its new one instead of
  // letting the whole list just snap. Rows with no previous position
  // (first mount, or newly appearing under a search) aren't animated.
  useLayoutEffect(() => {
    const prevRects = prevRectsRef.current
    const nextRects = new Map<string, DOMRect>()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    rowRefs.current.forEach((el, id) => {
      const rect = el.getBoundingClientRect()
      nextRects.set(id, rect)
      if (reduceMotion) return
      const prev = prevRects.get(id)
      if (!prev) return
      const deltaY = prev.top - rect.top
      if (Math.abs(deltaY) < 1) return
      el.animate([{ transform: `translateY(${deltaY}px)` }, { transform: 'none' }], {
        duration: 360,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      })
    })

    prevRectsRef.current = nextRects
  }, [visits])

  return (
    <>
      {visits.map((v) => {
        const name = visitDisplayName(v)
        const trimmedLower = trimmed.toLowerCase()
        const index = trimmed ? name.toLowerCase().indexOf(trimmedLower) : -1
        return (
          <div
            key={v.id}
            ref={(el) => {
              if (el) rowRefs.current.set(v.id, el)
              else rowRefs.current.delete(v.id)
            }}
            onClick={() => onSelect(v.id)}
            style={{
              cursor: 'pointer',
              padding: 'var(--space-2)',
              borderRadius: 'var(--radius-md)',
              background: v.id === activeId ? 'var(--accent-safe-surface)' : 'transparent',
            }}
          >
            <div
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: (v.id === activeId ? 'var(--font-weight-bold)' : 'var(--font-weight-regular)') as unknown as number,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {index === -1 ? (
                name
              ) : (
                <>
                  {name.slice(0, index)}
                  <span style={{ background: 'var(--accent-safe-surface)', color: 'var(--accent-safe)', borderRadius: 3 }}>
                    {name.slice(index, index + trimmed.length)}
                  </span>
                  {name.slice(index + trimmed.length)}
                </>
              )}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
              {v.status === 'active'
                ? t('sidebar.liveNow')
                : v.scheduledAt
                  ? formatScheduledAt(v.scheduledAt, effectiveTimeZone)
                  : v.status === 'completed'
                    ? t('sidebar.ended')
                    : t('sidebar.notStarted')}
            </div>
          </div>
        )
      })}
    </>
  )
}

// A near-instant, no-animation jump to the newest message when a
// session's chat first has data to show (covers both the initial load
// of an existing conversation and switching into an empty one) —
// distinct from the smooth scroll used for a live incoming message,
// which reads as an update rather than a fresh page.
const NEAR_BOTTOM_THRESHOLD_PX = 48

function isNearBottom(el: HTMLElement, threshold = NEAR_BOTTOM_THRESHOLD_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}

// Keeps rendering its content for `exitDurationMs` after `show` flips
// false, so a caller can drive a CSS opacity transition to a real close
// (fade out, then unmount) instead of the element just vanishing.
function useDelayedUnmount(show: boolean, exitDurationMs: number): boolean {
  const [mounted, setMounted] = useState(show)
  useEffect(() => {
    if (show) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), exitDurationMs)
    return () => clearTimeout(timer)
  }, [show, exitDurationMs])
  return mounted
}

// A calm, centered waiting card over a blurred backdrop — replaces a
// literal loading skeleton (which read as an abrupt, "snappy" content
// swap) for the brief join/guidelines-check gate on every session
// switch. Fades in on mount and, via the caller's useDelayedUnmount,
// fades out to reveal the real content underneath rather than cutting.
function CenterPanelLoadingOverlay({ exiting }: { exiting: boolean }) {
  return (
    <div className={['dash-loading-overlay', exiting && 'dash-loading-overlay--exiting'].filter(Boolean).join(' ')}>
      <div className="dash-loading-overlay__card">
        <Spinner size={26} />
      </div>
    </div>
  )
}

// Inline stand-in for ErrorPage, scoped to just the center panel — the
// sidebar (and the rest of the shell) stays visible and usable even
// when the currently-selected session can't load, since a session
// switch never remounts the shell any more.
function CenterPanelMessage({ code, title, message }: { code?: number; title: string; message: string }) {
  const { t } = useTranslation('session')
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)' }}>
      <div style={{ maxWidth: 360, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {code !== undefined && (
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>
            {t('centerPanelError.errorCode', { code })}
          </div>
        )}
        <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{message}</div>
      </div>
    </div>
  )
}

// checking: existence check in flight (read-only — session.getSummary).
// joining: existence confirmed; actually joining + recording the visit
//   (session.visit). The community-guidelines agreement lives on this
//   session's own session_users row (migrations/0013), so joining has to
//   happen before the row exists to check/record agreement against it.
// checking-guidelines: join succeeded; checking (and syncing onto this
//   row) which required keys this user has already agreed to anywhere —
//   session.checkGuidelines.
// needs-agreement / agreeing: not every required key is covered yet —
//   see CommunityGuidelinesModal, which pre-checks whatever's in
//   `agreedKeys` (e.g. a user who agreed before a new checkbox was added
//   sees everything but that one already checked) and leaves the rest
//   for the user to actually check. Recording it (agreeing) writes onto
//   this same already-joined row — see recordGuidelinesAgreement's
//   merge semantics for why already-agreed keys' original timestamps
//   are never disturbed by resubmitting the full set.
// ready: every required key covered (whether just now or via sync).
// error: not_found (getSummary or, defensively, visit's own re-check),
//   full (visit — a capacity race after existence was confirmed), or a
//   generic error.
type DashboardLoadState =
  | { status: 'checking' }
  | { status: 'joining' }
  | { status: 'checking-guidelines'; summary: SessionSummary }
  | { status: 'needs-agreement'; summary: SessionSummary; agreedKeys: string[] }
  | { status: 'agreeing'; summary: SessionSummary; agreedKeys: string[] }
  | { status: 'ready'; summary: SessionSummary }
  | { status: 'error'; kind: 'not_found' | 'full' | 'error' }

// Paper-plane send icon, in the style Telegram uses on its own send button —
// icon-only reads across languages without needing a translated label on the
// button face itself (an aria-label still carries the translated name for
// screen readers).
function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  )
}

// Mobile-only stand-in for the desktop avatar row + offline dropdown —
// one icon that opens a combined participants panel instead.
function UsersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15.5 4.3a3.2 3.2 0 010 6.2M17.5 20c0-2.7-1.1-4.9-3-6.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// A collapsible section header + chevron, shared by the mobile
// participants panel's "offline" toggle — a plain button rather than
// <details>/<summary> so its open state can be reset from outside (see
// mobilePanelOpen's collapse-on-close effect).
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform var(--duration-fast) var(--easing-standard)' }}
    >
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Everything below the shell that changes with the selected session: the
// join/guidelines state machine, the live chat (messages/roster/turn),
// the composer, and scroll tracking. Deliberately NOT remounted per
// session (no key= at its call site) — staying mounted across a switch
// is what lets it keep showing the previous session's chat, blurred
// under the loading overlay, until the new one is actually ready; see
// the swap-detection in the scroll-tracking effect below for how it
// resets per-session bits (draft, scroll position) without a remount.
function SessionCenterPanel({
  sessionId,
  mobileMenuOpen,
  onToggleMobileMenu,
  onReportableChange,
  onVisited,
}: {
  sessionId: string
  mobileMenuOpen: boolean
  onToggleMobileMenu: () => void
  onReportableChange: (reportable: Member[]) => void
  onVisited: () => void
}) {
  const { t } = useTranslation('session')
  const [loadState, setLoadState] = useState<DashboardLoadState>({ status: 'checking' })
  const { userId: myUserId } = useWhoAmI()
  const { effectiveTimeZone } = usePreferences()

  // Existence check — read-only, no join side effect. Re-runs on every
  // sessionId change (no remount to reset `loadState` for us), so it
  // explicitly resets to 'checking' itself first.
  useEffect(() => {
    let cancelled = false
    setLoadState({ status: 'checking' })
    void (async () => {
      try {
        await getSessionSummary(sessionId)
        if (!cancelled) setLoadState({ status: 'joining' })
      } catch (err) {
        if (cancelled) return
        const kind = err instanceof Error && err.message === 'not_found' ? 'not_found' : 'error'
        setLoadState({ status: 'error', kind })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Joins + records the visit — the session_users row the
  // guidelines-agreement check right below needs to already exist.
  useEffect(() => {
    if (loadState.status !== 'joining') return
    let cancelled = false
    void (async () => {
      try {
        const summary = await visitSession(sessionId)
        if (!cancelled) {
          setLoadState({ status: 'checking-guidelines', summary })
          // Only now has the backend actually bumped this session's
          // last_visited_at — telling the shell to refresh its sidebar
          // list any earlier (e.g. right on sessionId change) would race
          // ahead of this and capture a stale sort order.
          onVisited()
        }
      } catch (err) {
        if (cancelled) return
        const kind = err instanceof Error && (err.message === 'not_found' || err.message === 'full') ? err.message : 'error'
        setLoadState({ status: 'error', kind: kind as 'not_found' | 'full' | 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadState.status, sessionId, onVisited])

  // Checks which required keys this user has already agreed to
  // anywhere (this session or another) and syncs them onto this
  // session's row.
  useEffect(() => {
    if (loadState.status !== 'checking-guidelines') return
    const { summary } = loadState
    let cancelled = false
    void (async () => {
      try {
        const { agreed, agreedKeys } = await checkGuidelines(sessionId)
        if (cancelled) return
        setLoadState(agreed ? { status: 'ready', summary } : { status: 'needs-agreement', summary, agreedKeys })
      } catch {
        if (!cancelled) setLoadState({ status: 'error', kind: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `summary` comes from `loadState` via the guard above, not a separate dep; only the status transition should retrigger this
  }, [loadState.status, sessionId])

  async function handleAgree() {
    if (loadState.status !== 'needs-agreement') return
    const { summary, agreedKeys } = loadState
    setLoadState({ status: 'agreeing', summary, agreedKeys })
    try {
      await agreeToGuidelines(sessionId)
      setLoadState({ status: 'ready', summary })
    } catch {
      addToast(t('errors.agreementFailed'), { variant: 'urgent' })
      setLoadState({ status: 'needs-agreement', summary, agreedKeys })
    }
  }

  const isReady = loadState.status === 'ready'

  // Gated on isReady — getState/listMessages are membership-gated, and
  // this component reaches DOM well before the join/guidelines gate
  // resolves, so polling has to wait or it'd just 403 on every tick.
  // Note this hook keeps returning whatever it last fetched until a new
  // fetch actually resolves — it doesn't clear `state`/`messages` just
  // because `sessionId` changed. That's what lets a session switch keep
  // showing the previous session's chat (see `displayedSummary` below)
  // instead of a gap.
  const {
    state: sessionState,
    messages,
    error: chatError,
    send,
    loadOlderMessages,
    hasOlderMessages,
    loadingOlderMessages,
    messagesTopShiftVersion,
  } = useSessionChat(sessionId, isReady)

  // Whether the chat data currently held above actually belongs to this
  // panel's target `sessionId`, vs. still being the previous session's
  // (stale) data left over from before a switch.
  const chatMatchesTarget = sessionState?.id === sessionId

  // The summary actually shown in the header/empty-state — only ever
  // advances to the new session once ITS chat data has caught up too,
  // so the header and the messages below it never show two different
  // sessions at once. Starts null (nothing to show) only on the very
  // first load; a session switch keeps the previous value until ready.
  const [displayedSummary, setDisplayedSummary] = useState<SessionSummary | null>(null)
  useEffect(() => {
    if (loadState.status === 'ready' && chatMatchesTarget) setDisplayedSummary(loadState.summary)
  }, [loadState, chatMatchesTarget])

  useDocumentTitle(displayedSummary ? `${visitDisplayName(displayedSummary)} — MinCirklen` : 'MinCirklen')

  const [draft, setDraft] = useState('')
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  // Auto-grow the composer to fit its content, like other chat apps —
  // capped by CSS's max-height (.dash-composer-textarea, 4 lines), which
  // takes over as an internal scroll once content exceeds it rather than
  // growing the box any further. Reset to 'auto' first so shrinking (e.g.
  // the draft clearing after a send) actually shrinks the box back down
  // instead of scrollHeight only ever remembering its tallest value.
  useEffect(() => {
    const el = composerTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])
  const [isSending, setIsSending] = useState(false)
  const [crisisResource, setCrisisResource] = useState<CrisisResource | null>(null)
  // Optimistic — the actual server-side record is
  // ChatMessage.falsePositiveReportedAt, but that only updates on the
  // next listMessages fetch. Tracked locally so the button disables
  // immediately rather than waiting on a round-trip.
  const [reportedMessageIds, setReportedMessageIds] = useState<Set<string>>(new Set())

  async function handleReportFalsePositive(messageId: string) {
    setReportedMessageIds((prev) => new Set(prev).add(messageId))
    try {
      await reportFalsePositive(sessionId, messageId)
      addToast(t('composer.falsePositiveReported'), { variant: 'info' })
    } catch {
      addToast(t('errors.sendFailed'), { variant: 'urgent' })
    }
  }
  const [offlinePanelOpen, setOfflinePanelOpen] = useState(false)
  const offlinePanelRef = useRef<HTMLDivElement>(null)
  // Mobile-only: the avatar row + offline dropdown above collapse into a
  // single icon button that opens a right-side drawer (mirroring the
  // left-side session-list drawer) — online members always shown,
  // offline members behind their own collapse toggle so a large
  // past-participant list doesn't dominate a small screen.
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
  const [mobileOfflineExpanded, setMobileOfflineExpanded] = useState(false)
  const [autoSendEnabled, setAutoSendEnabledState] = useState(getInitialAutoSend)
  const [sendMenuOpen, setSendMenuOpen] = useState(false)

  function setAutoSendEnabled(next: boolean) {
    window.localStorage.setItem(AUTO_SEND_STORAGE_KEY, String(next))
    setAutoSendEnabledState(next)
  }

  const roster = sessionState?.roster ?? []
  const isYourTurn = sessionState?.currentTurnUserId !== null && sessionState?.currentTurnUserId === myUserId
  // Memoized: this component also holds `draft`, so every keystroke in
  // the composer re-renders it — without memoizing on the (stable
  // between actual roster/message updates) `roster`/`messages`
  // references, these would otherwise be rebuilt from scratch on every
  // single keystroke for no reason.
  const members = useMemo(() => roster.map((r) => memberFor(r.userId, roster, myUserId)), [roster, myUserId])

  // Split the roster into who's actually here right now vs. who has
  // ever been here — the header row only ever shows the former, so it
  // reads as "who's in the room" rather than a growing list of everyone
  // who's ever passed through. A past participant only qualifies for the
  // "offline" list if they actually said something — someone who joined
  // and immediately left without a word was never really part of the
  // conversation, and surfacing them just adds noise (this also quietly
  // keeps stray test/ghost joins out of the list).
  const onlineUserIds = sessionState?.onlineUserIds ?? []
  // 'system' rows (a join marker) don't count as "said something" —
  // otherwise everyone who's ever joined would immediately qualify for
  // the offline list even if they never sent a real message.
  const messagedUserIds = useMemo(() => new Set(messages.filter((m) => m.type === 'user').map((m) => m.userId)), [messages])
  const onlineMembers = useMemo(() => members.filter((m) => onlineUserIds.includes(m.userId)), [members, onlineUserIds])
  const offlineMembers = useMemo(
    () => members.filter((m) => !onlineUserIds.includes(m.userId) && messagedUserIds.has(m.userId)),
    [members, onlineUserIds, messagedUserIds],
  )
  // Keyed lookup with a stable Member object per userId — MessageRow is
  // memoized on shallow prop equality, so handing it a freshly-built
  // object from memberFor(...) on every render (as before) would defeat
  // that memoization just as badly as not memoizing at all.
  const memberByUserId = useMemo(() => {
    const map = new Map<string, Member>()
    for (const m of messages) {
      if (!map.has(m.userId)) map.set(m.userId, memberFor(m.userId, roster, myUserId))
    }
    return map
  }, [messages, roster, myUserId])

  useEffect(() => {
    if (!offlinePanelOpen) return
    function handlePointerDown(e: PointerEvent) {
      if (offlinePanelRef.current && !offlinePanelRef.current.contains(e.target as Node)) {
        setOfflinePanelOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [offlinePanelOpen])

  // Collapse the offline section again each time the panel is closed, so
  // reopening it always starts from the same compact "online only" state
  // rather than remembering whatever was expanded last time.
  useEffect(() => {
    if (!mobilePanelOpen) setMobileOfflineExpanded(false)
  }, [mobilePanelOpen])

  // Lifts the reportable roster up to the shell, which owns
  // ReportSessionModal — it needs to live at the shell level regardless,
  // since it should stay open (reporting the same session) even if the
  // sidebar's search or other shell state changes underneath it.
  useEffect(() => {
    onReportableChange(members.filter((m) => m.userId !== myUserId))
    return () => onReportableChange([])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the roster/identity should retrigger this, not onReportableChange's identity
  }, [sessionState?.roster, myUserId])

  const turnStatusText = !sessionState
    ? ''
    : sessionState.status !== 'active'
      ? t('composer.sessionNotActive')
      : isYourTurn
        ? t('composer.itsYourTurn')
        : sessionState.currentTurnUserId
          ? t('composer.hasTheFloor', { name: memberFor(sessionState.currentTurnUserId, roster, myUserId).label })
          : t('composer.waitingForNextUser')

  async function sendNow() {
    const text = draft.trim()
    // The input itself is never turn-gated (composing ahead is always
    // allowed — see the input's own comment), so this has to guard
    // itself: pressing Enter while it isn't your turn yet must silently
    // no-op, not fire a doomed request that'd just 403 and surface a
    // confusing "something went wrong" toast for something the user
    // never actually did wrong.
    if (!text || !isYourTurn) return
    setIsSending(true)
    try {
      const outcome = await send(text)
      setDraft('')
      if (outcome.status === 'held') {
        addToast(t('errors.messageHeld'), { variant: 'urgent' })
      } else if (outcome.status === 'crisis') {
        setCrisisResource(outcome.resource)
      } else {
        setCrisisResource(null)
      }
    } catch (err) {
      // The same account open in more than one tab/window each runs its
      // own local auto-send countdown — if two race to claim/send the
      // same turn, the loser gets this back. Not a failure worth
      // alarming the user about; the turn already moved on exactly as
      // intended via whichever tab won (mirrors autoSkipTurn's identical
      // handling of its own equivalent race).
      if (!(err instanceof SendMessageConflictError)) {
        addToast(t('errors.sendFailed'), { variant: 'urgent' })
      }
    } finally {
      setIsSending(false)
    }
  }

  async function autoSkipTurn() {
    try {
      // Deliberately no toast on a successful skip — it fires while the
      // user may be mid-scroll reading older messages, and a toast
      // popping up over that is more disruptive than the skip itself.
      await skipTurn(sessionId)
    } catch (err) {
      // The same account open in more than one tab/window each runs its
      // own local countdown — if both race to skip the same turn, the
      // loser correctly gets rejected here. That's not a failure worth
      // alarming the user about; the turn already moved on exactly as
      // intended via the tab that won.
      if (err instanceof SkipTurnNotYourTurnError) return
      addToast(t('errors.skipFailed'), { variant: 'urgent' })
    }
  }

  // Only armed once the session is actually usable (isReady) and it's
  // genuinely this viewer's turn — matches the same guard the composer's
  // own `disabled` prop already uses, so the countdown can never appear
  // for a turn the input itself wouldn't let you act on.
  const turnSecondsLeft = useTurnCountdown(isReady && isYourTurn, draft, () => {
    // With auto-send off, a drafted-but-unsent message never gets
    // force-submitted on your behalf — running out of time always just
    // costs you the turn instead, same as if you'd left it empty.
    if (draft.trim() && autoSendEnabled) {
      void sendNow()
    } else {
      void autoSkipTurn()
    }
  })

  // Scroll tracking: jump to the newest message the first time this
  // session actually has any to show (covers both "load an existing
  // conversation" and "watch an empty one get its first message"),
  // auto-follow smoothly while the user is at/near the bottom, and
  // otherwise leave their scroll position alone and surface a
  // click-to-jump indicator instead.
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const prevMessageCountRef = useRef<number | null>(null)
  const initialScrollDoneRef = useRef(false)
  const [newMessageCount, setNewMessageCount] = useState(0)
  // Tracks the last messagesTopShiftVersion this effect has already
  // accounted for — a loadOlderMessages prepend also grows messages.length,
  // but it must never be mistaken for "new messages arrived" (which would
  // wrongly auto-scroll-to-bottom or show the jump-to-bottom pill for
  // messages that are actually older, not new). See the check at the top
  // of the "same session" branch below.
  const prevTopShiftVersionRef = useRef(messagesTopShiftVersion)

  // Tracks which session's data `messages` last belonged to — this
  // panel no longer remounts on a session switch (that's what lets it
  // keep showing the previous session blurred underneath the loading
  // overlay), so this effect has to notice the handoff itself instead
  // of getting a clean slate for free.
  const lastMessagesSessionIdRef = useRef<string | null>(null)

  // Plain scrollTop assignment, not scrollTo({ behavior: 'smooth' }) —
  // smooth-behavior scrollTo silently no-ops in some automated/headless
  // Chrome contexts (verified live), and an instant jump reads fine for
  // a chat catching up on new messages. Returns whether it actually acted
  // (the ref was attached) — callers use this to decide whether it's safe
  // to mark the scroll as done, or whether they need to retry once the
  // container actually exists (see the effect below's displayedSummary
  // comment for why the ref can still be null on this call).
  function scrollToBottom(): boolean {
    const el = messagesContainerRef.current
    if (!el) return false
    el.scrollTop = el.scrollHeight
    return true
  }

  function handleScroll() {
    const el = messagesContainerRef.current
    if (!el) return
    const atBottom = isNearBottom(el)
    isAtBottomRef.current = atBottom
    if (atBottom) setNewMessageCount(0)
  }

  function jumpToBottom() {
    scrollToBottom()
    setNewMessageCount(0)
  }

  useEffect(() => {
    const currentSessionId = sessionState?.id ?? null
    if (currentSessionId !== lastMessagesSessionIdRef.current) {
      lastMessagesSessionIdRef.current = currentSessionId
      // A different session's data just landed (or this is the very
      // first load) — treat it as a fresh conversation for scroll
      // purposes: jump straight to the bottom, don't count any of it
      // as "new" messages to flag, and reset the composer draft, which
      // belongs to whichever session it was typed in.
      prevMessageCountRef.current = messages.length
      // Only markable "done" once scrollToBottom actually had a ref to
      // act on — messagesContainerRef's div can still be unmounted at
      // this exact point (see the displayedSummary dependency's comment
      // below), and marking this true regardless would permanently skip
      // the retry once the div does mount, since prevMessageCountRef
      // above already absorbed this message count either way.
      initialScrollDoneRef.current = messages.length > 0 && scrollToBottom()
      isAtBottomRef.current = true
      setNewMessageCount(0)
      setDraft('')
      setIsSending(false)
      setCrisisResource(null)
      return
    }

    if (messagesTopShiftVersion !== prevTopShiftVersionRef.current) {
      // A loadOlderMessages prepend, not a new/live message — resync the
      // length baseline so its delta never reads as "N new messages" on
      // the next real change, and never touch isAtBottomRef/
      // newMessageCount/auto-scroll for it. Scroll position itself is
      // handled separately by useScrollShiftCompensation.
      prevTopShiftVersionRef.current = messagesTopShiftVersion
      prevMessageCountRef.current = messages.length
      return
    }

    const prevCount = prevMessageCountRef.current
    prevMessageCountRef.current = messages.length

    if (!initialScrollDoneRef.current) {
      if (messages.length > 0) {
        initialScrollDoneRef.current = scrollToBottom()
      }
      return
    }

    if (prevCount === null) return
    const added = messages.length - prevCount
    if (added <= 0) return

    if (isAtBottomRef.current) {
      scrollToBottom()
    } else {
      setNewMessageCount((n) => n + added)
    }
    // displayedSummary is a dependency too, not just messages: it gates
    // whether this panel's JSX (and therefore messagesContainerRef's div)
    // is mounted at all, and it flips null -> non-null one render *after*
    // messages first populates (its own setter lives in a separate
    // effect) — so on a fresh load, messages changes on a render where
    // the ref is still null (a no-op scrollToBottom), and by the time the
    // div actually mounts, messages hasn't changed again to re-trigger
    // this effect. Depending on displayedSummary too re-fires this effect
    // on that exact transition, guaranteeing at least one firing sees a
    // real ref.
  }, [messages, displayedSummary, messagesTopShiftVersion])

  // Scroll-up-for-older-messages pagination — same fundamental technique
  // as pages/start/shared.tsx's windowed browse list (a sentinel watched
  // by an IntersectionObserver rooted at the scroll container, plus
  // scroll-position compensation so the prepend doesn't visibly jump the
  // view), via the shared useScrollShiftCompensation hook. Unidirectional
  // (top only): new messages arrive live at the bottom over the
  // WebSocket, never via pagination — see useSessionChat's own doc
  // comment.
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const { snapshotBeforeShift } = useScrollShiftCompensation(messagesContainerRef, messagesTopShiftVersion)

  function handleLoadOlderMessages() {
    snapshotBeforeShift()
    void loadOlderMessages()
  }

  useEffect(() => {
    const root = messagesContainerRef.current
    const sentinel = topSentinelRef.current
    if (!root || !sentinel || !hasOlderMessages) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) handleLoadOlderMessages()
      },
      { root, rootMargin: '80px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleLoadOlderMessages reads live refs/callbacks, doesn't need to be a dependency. displayedSummary is included for the same reason as the scroll-tracking effect above: it gates whether this panel's JSX (and therefore both refs) is mounted at all, and can flip true one render after hasOlderMessages/messages.length already did — without it, this effect can fire once with both refs still null and never get another chance to attach the observer.
  }, [hasOlderMessages, messages.length, displayedSummary])

  // The join/guidelines-check gate on every session switch used to swap
  // the whole panel for a literal loading skeleton, which read as an
  // abrupt, "snappy" content change. Instead this only ever shows a
  // calm waiting overlay on top of the panel — kept mounted a little
  // past the gate closing (useDelayedUnmount) so it fades out and
  // reveals whatever loaded underneath, rather than cutting away. Stays
  // open through `ready` until the chat data catches up too
  // (chatMatchesTarget), so a session switch blurs the previous
  // session's still-visible chat instead of a blank panel.
  const isLoadingGate =
    loadState.status === 'checking' ||
    loadState.status === 'joining' ||
    loadState.status === 'checking-guidelines' ||
    (loadState.status === 'ready' && !chatMatchesTarget)
  const showLoadingOverlay = useDelayedUnmount(isLoadingGate, 260)

  let content: React.ReactNode = null
  if (loadState.status === 'error') {
    if (loadState.kind === 'not_found') {
      content = <CenterPanelMessage code={404} title={t('centerPanelError.notFoundTitle')} message={t('centerPanelError.notFoundMessage')} />
    } else if (loadState.kind === 'full') {
      content = <CenterPanelMessage code={409} title={t('centerPanelError.fullTitle')} message={t('centerPanelError.fullMessage')} />
    } else {
      content = <CenterPanelMessage code={500} title={t('centerPanelError.genericTitle')} message={t('centerPanelError.genericMessage')} />
    }
  } else if (loadState.status === 'needs-agreement' || loadState.status === 'agreeing') {
    content = (
      <CommunityGuidelinesModal
        isOpen
        onAgree={() => void handleAgree()}
        isAgreeing={loadState.status === 'agreeing'}
        agreedKeys={loadState.agreedKeys}
      />
    )
  } else if (displayedSummary) {
    const summary = displayedSummary
    const subtitle = statusSubtitle(summary, effectiveTimeZone, t)
    content = (
      <>
        <div
          className="dash-panel-header"
          style={{
            borderBottom: '0.5px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'nowrap',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0, flex: '1 1 auto' }}>
            <button
              type="button"
              className="dash-mobile-toggle"
              onClick={onToggleMobileMenu}
              aria-expanded={mobileMenuOpen}
              aria-label={t('panel.toggleMenu')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 'var(--font-size-md)',
                  fontWeight: 'var(--font-weight-bold)' as unknown as number,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {visitDisplayName(summary)}
              </div>
              {subtitle && (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 2 }}>{subtitle}</div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flex: 'none' }}>
            <ThemeToggle />
            <div className="dash-header-participants--desktop">
              {onlineMembers.map((m) => (
                <MemberAvatar key={m.userId} member={m} size={28} ringed={m.userId === sessionState?.currentTurnUserId} online />
              ))}
              {offlineMembers.length > 0 && (
                <div ref={offlinePanelRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    aria-label={t('panel.showOfflineParticipants', { count: offlineMembers.length })}
                    aria-expanded={offlinePanelOpen}
                    onClick={() => setOfflinePanelOpen((v) => !v)}
                    style={{
                      width: 28,
                      height: 28,
                      flex: 'none',
                      borderRadius: '50%',
                      border: '1px dashed var(--border-strong)',
                      background: offlinePanelOpen ? 'var(--surface-sunken)' : 'transparent',
                      color: 'var(--text-secondary)',
                      fontSize: 10,
                      fontWeight: 'var(--font-weight-bold)' as unknown as number,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    +{offlineMembers.length}
                  </button>
                  {offlinePanelOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        right: 0,
                        zIndex: 20,
                        width: 200,
                        maxWidth: 'calc(100vw - 32px)',
                        boxSizing: 'border-box',
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: 8,
                        padding: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        boxShadow: 'var(--shadow-md)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 'var(--font-size-xs)',
                          color: 'var(--text-secondary)',
                          fontWeight: 'var(--font-weight-medium)' as unknown as number,
                          padding: '2px 6px 6px',
                        }}
                      >
                        {t('panel.notCurrentlyOnline')}
                      </div>
                      {offlineMembers.map((m) => (
                        <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px' }}>
                          <MemberAvatar member={m} size={24} />
                          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{m.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginLeft: 4 }}>
                {t('panel.userCount', { count: onlineMembers.length })}
              </span>
            </div>
            <div className="dash-header-participants--mobile" style={{ position: 'relative' }}>
              <IconButton
                icon={<UsersIcon />}
                label={t('panel.participantsButton', { count: onlineMembers.length })}
                aria-expanded={mobilePanelOpen}
                onClick={() => setMobilePanelOpen(true)}
              />
              {onlineMembers.length > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -2,
                    minWidth: 16,
                    height: 16,
                    padding: '0 4px',
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--accent-safe)',
                    color: 'var(--text-on-accent)',
                    fontSize: 10,
                    fontWeight: 'var(--font-weight-bold)' as unknown as number,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 0 2px var(--surface-app)',
                    pointerEvents: 'none',
                  }}
                >
                  {onlineMembers.length}
                </span>
              )}
            </div>
          </div>
        </div>

        {mobilePanelOpen && <div className="dash-participants-drawer-backdrop" onClick={() => setMobilePanelOpen(false)} />}
        <div className={['dash-participants-drawer', mobilePanelOpen && 'dash-participants-drawer--open'].filter(Boolean).join(' ')}>
          <div className="dash-participants-drawer__header">
            <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)' }}>
              {t('panel.participantsTitle')}
            </span>
            <IconButton
              icon={
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              }
              label={t('panel.closeParticipants')}
              onClick={() => setMobilePanelOpen(false)}
            />
          </div>
          <div className="dash-participants-drawer__list">
            <div
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--text-secondary)',
                fontWeight: 'var(--font-weight-medium)' as unknown as number,
                padding: '2px 6px 6px',
              }}
            >
              {t('panel.onlineSectionLabel')}
            </div>
            {onlineMembers.map((m) => (
              <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px' }}>
                <MemberAvatar member={m} size={28} ringed={m.userId === sessionState?.currentTurnUserId} online />
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{m.label}</span>
              </div>
            ))}
            {offlineMembers.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setMobileOfflineExpanded((v) => !v)}
                  aria-expanded={mobileOfflineExpanded}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    gap: 6,
                    marginTop: 6,
                    padding: '8px 6px',
                    border: 'none',
                    borderTop: '0.5px solid var(--border-subtle)',
                    background: 'none',
                    fontFamily: 'var(--font-family-base)',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-secondary)',
                    fontWeight: 'var(--font-weight-medium)' as unknown as number,
                    cursor: 'pointer',
                  }}
                >
                  {t('panel.offlineToggle', { count: offlineMembers.length })}
                  <ChevronIcon expanded={mobileOfflineExpanded} />
                </button>
                {mobileOfflineExpanded &&
                  offlineMembers.map((m) => (
                    <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px' }}>
                      <MemberAvatar member={m} size={28} />
                      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{m.label}</span>
                    </div>
                  ))}
              </>
            )}
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="dash-messages"
            style={{
              position: 'absolute',
              inset: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            {chatError && <Alert variant="urgent">{chatError}</Alert>}
            {/* messagedUserIds already excludes system rows (see its own
                comment above) — empty means no *real* message yet, even
                if a "joined" marker is already showing below. */}
            {!chatError && messagedUserIds.size === 0 && (
              <div style={{ margin: 'auto', color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', maxWidth: 320 }}>
                {emptyStateText(summary, t)}
              </div>
            )}
            {hasOlderMessages && <div ref={topSentinelRef} style={{ height: 1, flexShrink: 0 }} />}
            {loadingOlderMessages && (
              <div style={{ display: 'flex', gap: 10, maxWidth: 560 }}>
                <Skeleton width={32} height={32} radius="var(--radius-full)" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <Skeleton width={72} height={12} />
                  <Skeleton width="80%" height={40} radius="var(--radius-md)" />
                </div>
              </div>
            )}
            {messages.map((m) =>
              m.type === 'system' ? (
                <JoinEventRow
                  key={m.id}
                  message={m}
                  member={memberByUserId.get(m.userId) ?? memberFor(m.userId, roster, myUserId)}
                  timeZone={effectiveTimeZone}
                  t={t}
                />
              ) : (
                <MessageRow
                  key={m.id}
                  message={m}
                  member={memberByUserId.get(m.userId) ?? memberFor(m.userId, roster, myUserId)}
                  isOwn={m.userId === myUserId}
                  timeZone={effectiveTimeZone}
                  onReportFalsePositive={handleReportFalsePositive}
                  isReported={reportedMessageIds.has(m.id)}
                  t={t}
                />
              ),
            )}
          </div>
          {newMessageCount > 0 && (
            <button
              type="button"
              onClick={jumpToBottom}
              style={{
                position: 'absolute',
                bottom: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 'var(--radius-full)',
                border: 'none',
                background: 'var(--accent-safe)',
                color: 'var(--text-on-accent)',
                fontFamily: 'var(--font-family-base)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-medium)' as unknown as number,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                cursor: 'pointer',
              }}
            >
              {t('composer.newMessages', { count: newMessageCount })} ↓
            </button>
          )}
        </div>

        <div className="dash-composer" style={{ borderTop: '0.5px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {crisisResource && (
            <CrisisModal
              resource={crisisResource}
              onOpenChange={(open) => {
                if (!open) setCrisisResource(null)
              }}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: isYourTurn ? 'var(--accent-safe)' : 'var(--text-secondary)', fontWeight: isYourTurn ? ('var(--font-weight-medium)' as unknown as number) : undefined }}>
              {turnStatusText}
            </span>
            {turnSecondsLeft !== null && (
              <span
                role="timer"
                aria-live="polite"
                style={{
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 'var(--font-weight-bold)' as unknown as number,
                  color: 'var(--signal-urgent)',
                  background: 'var(--signal-urgent-surface)',
                  border: '1px solid var(--signal-urgent)',
                  borderRadius: 'var(--radius-full)',
                  padding: '1px 8px',
                }}
              >
                {draft.trim() && autoSendEnabled
                  ? t('composer.sendingIn', { count: turnSecondsLeft })
                  : t('composer.skippingIn', { count: turnSecondsLeft })}
              </span>
            )}
            {turnSecondsLeft !== null && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{t('composer.keepTypingToPause')}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <textarea
              ref={composerTextareaRef}
              className="dash-composer-textarea"
              rows={1}
              style={{ flex: '1 1 160px', boxSizing: 'border-box' }}
              // Composing ahead is always allowed, even before it's your
              // turn — only actually sending is turn-gated (sendNow itself
              // no-ops if it isn't your turn yet; the Send button below is
              // separately disabled for the same reason). Still blocked
              // once the session itself is over — there's nothing left to
              // send to. Also locked for the duration of an in-flight send:
              // editing a message that's already on its way to the server
              // would be confusing (which text actually got sent?), and the
              // draft is about to be cleared out from under it anyway.
              disabled={sessionState?.status !== 'active' || isSending}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Shift+Enter falls through to the textarea's own default
                // behavior (insert a newline) — only a bare Enter sends.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendNow()
                }
              }}
              placeholder={t('composer.placeholder')}
            />
            <div className="dash-composer-actions--desktop">
              <div className="dash-send-split">
                <button
                  type="button"
                  className="dash-send-split__main"
                  aria-label={t('composer.send')}
                  disabled={!isYourTurn || isSending || !draft.trim()}
                  onClick={() => void sendNow()}
                >
                  {isSending ? <Spinner size={14} /> : <SendIcon />}
                </button>
                <button
                  type="button"
                  className="dash-send-split__toggle"
                  aria-label={t('composer.sendOptions')}
                  aria-expanded={sendMenuOpen}
                  onClick={() => setSendMenuOpen((v) => !v)}
                >
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
                    <path d="M1 5L5 1L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {sendMenuOpen && (
                  <>
                    <div className="dash-send-backdrop" onClick={() => setSendMenuOpen(false)} />
                    <div className="dash-send-menu">
                      <Switch className="dash-send-menu__option" isSelected={autoSendEnabled} onChange={setAutoSendEnabled}>
                        {t('composer.autoSendToggle')}
                      </Switch>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="dash-composer-actions--mobile">
              <div className="dash-send-split">
                <button
                  type="button"
                  className="dash-send-split__main"
                  aria-label={t('composer.send')}
                  disabled={!isYourTurn || isSending || !draft.trim()}
                  onClick={() => void sendNow()}
                >
                  {isSending ? <Spinner size={14} /> : <SendIcon />}
                </button>
                <button
                  type="button"
                  className="dash-send-split__toggle"
                  aria-label={t('composer.sendOptions')}
                  aria-expanded={sendMenuOpen}
                  onClick={() => setSendMenuOpen((v) => !v)}
                >
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
                    <path d="M1 5L5 1L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {sendMenuOpen && (
                  <>
                    <div className="dash-send-backdrop" onClick={() => setSendMenuOpen(false)} />
                    <div className="dash-send-menu">
                      <Switch className="dash-send-menu__option" isSelected={autoSendEnabled} onChange={setAutoSendEnabled}>
                        {t('composer.autoSendToggle')}
                      </Switch>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="dash-center" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
      {content}
      {showLoadingOverlay && <CenterPanelLoadingOverlay exiting={!isLoadingGate} />}
    </div>
  )
}

export function SessionPage({ sessionId, onNavigate }: { sessionId: string; onNavigate: (sessionId: string) => void }) {
  const { t } = useTranslation('session')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState('')
  const [reportable, setReportable] = useState<Member[]>([])
  // Bumped by SessionCenterPanel's onVisited, once a session's visit is
  // actually recorded server-side — see useRecentVisits' refreshKey
  // param for why this can't just be `sessionId` (that fires the
  // background refresh before the visit lands, racing to a stale order).
  const [visitNonce, setVisitNonce] = useState(0)

  const { visits, loadingInitial: visitsLoading, loadingMore, error: visitsError, hasMore, loadMore } = useRecentVisits(searchDraft, String(visitNonce))

  function selectVisit(id: string) {
    setMobileMenuOpen(false)
    if (id !== sessionId) onNavigate(id)
  }

  const sidebarHeader = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 22, height: 22, borderRadius: 'var(--radius-full)', border: '1.5px solid var(--text-primary)' }} />
          <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)' }}>
            MinCirklen
          </span>
        </div>
        <IconButton
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
          label={t('sidebar.account')}
          onClick={() => setAccountModalOpen(true)}
        />
      </div>
      <Button variant="safe" onPress={() => setNewSessionOpen(true)} style={{ width: '100%' }}>
        {t('sidebar.newSession')}
      </Button>
      <input
        placeholder={t('sidebar.searchSessions')}
        className="ds-textfield__input dash-sidebar-search"
        value={searchDraft}
        onChange={(e) => setSearchDraft(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
    </>
  )

  const sidebarList = (
    <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {visitsLoading && <DashboardSidebarSkeleton />}
      {visitsError && <Alert variant="urgent">{visitsError}</Alert>}
      {!visitsLoading && !visitsError && (
        <>
          <RecentVisitsList visits={visits} activeId={sessionId} search={searchDraft} onSelect={selectVisit} />
          {visits.length === 0 && (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>
              {t('sidebar.noSessionsMatch')}
            </div>
          )}
          {hasMore && (
            <Button variant="ghost" isPending={loadingMore} onPress={loadMore} style={{ width: '100%' }}>
              {t('sidebar.loadMore')}
            </Button>
          )}
        </>
      )}
    </div>
  )

  const sidebarContent = (
    <>
      {sidebarHeader}
      {sidebarList}
    </>
  )

  const rightPanelContent = (
    <>
      <div>
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
          {t('rightPanel.essentialPages')}
        </div>
        {(['how-it-works', 'safety-and-moderation', 'account-and-data'] as const).map((id) => (
          <div key={id}>
            <a
              href={publicPagePath(id)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMobileMenuOpen(false)}
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
                href={moderationTransparencyPath()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenuOpen(false)}
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
      <div style={{ borderTop: '0.5px solid var(--border-subtle)' }} />
      <div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
          {t('rightPanel.ifInCrisis')}
        </div>
        <a
          href={publicPagePath('crisis-resources')}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setMobileMenuOpen(false)}
          style={{
            display: 'block',
            background: 'var(--signal-urgent-surface)',
            color: 'var(--signal-urgent)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3) var(--space-3)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-bold)' as unknown as number,
            marginBottom: 'var(--space-2)',
            textAlign: 'center',
            textDecoration: 'none',
          }}
        >
          {t('rightPanel.crisisResources')}
        </a>
        <button
          type="button"
          onClick={() => {
            setReportOpen(true)
            setMobileMenuOpen(false)
          }}
          style={{
            display: 'block',
            width: '100%',
            background: 'none',
            border: 'none',
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-primary)',
            textAlign: 'left',
            padding: 'var(--space-2) 0',
            cursor: 'pointer',
          }}
        >
          {t('rightPanel.reportThisSession')}
        </button>
      </div>
    </>
  )

  return (
    <div className="dash-root" style={{ display: 'flex', height: '100%', fontFamily: 'var(--font-family-base)', background: 'var(--surface-app)' }}>
      <ReportSessionModal isOpen={reportOpen} onOpenChange={setReportOpen} sessionId={sessionId} reportable={reportable} />
      <NewSessionModal isOpen={newSessionOpen} onOpenChange={setNewSessionOpen} onJoined={(id) => onNavigate(id)} />
      <AccountModal isOpen={accountModalOpen} onOpenChange={setAccountModalOpen} />

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
        {sidebarContent}
      </div>

      {mobileMenuOpen && <div className="dash-drawer-backdrop" onClick={() => setMobileMenuOpen(false)} />}

      <div className={['dash-drawer', mobileMenuOpen && 'dash-drawer--open'].filter(Boolean).join(' ')}>
        <div className="dash-drawer__header">{sidebarHeader}</div>
        <div className="dash-drawer__list">{sidebarList}</div>
        <div className="dash-drawer__footer">{rightPanelContent}</div>
      </div>

      {/* Center panel — stays mounted across a session switch (no key=)
          so it can keep showing the previous session, blurred, until
          the new one is ready; see SessionCenterPanel's own notes. */}
      <SessionCenterPanel
        sessionId={sessionId}
        mobileMenuOpen={mobileMenuOpen}
        onToggleMobileMenu={() => setMobileMenuOpen((v) => !v)}
        onReportableChange={setReportable}
        onVisited={() => setVisitNonce((n) => n + 1)}
      />

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
