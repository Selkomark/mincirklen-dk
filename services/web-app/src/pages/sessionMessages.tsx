import { memo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Avatar } from '../components/Avatar'
import { IconButton } from '../components/IconButton'
import type { ChatMessage, RosterEntry } from './sessionShared'

// The pieces of a circle's conversation that render the same wherever a
// transcript is shown: how a member is labelled and coloured (memberFor /
// MemberAvatar), a message bubble (MessageRow), a "joined" line
// (JoinEventRow) and the timestamp format. Extracted from SessionPage.tsx
// so the moderator's report review (pages/manage/ReportsTab.tsx) shows a
// reported circle exactly as its members saw it — not a re-styled copy.

export interface Member {
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
export function memberFor(userId: string, roster: RosterEntry[], myUserId: string | null): Member {
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
export function MemberAvatar({
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
export const FlagIcon = (
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
//
// `highlight` draws a signal-colored ring around the bubble — a selected
// message in the circle's own report flow, or a reported message in the
// moderator transcript (pages/manage/ReportsTab.tsx). `highlightLabel`
// is an independent small tag in the header line ("Reported member",
// "Reported message"); either can be used without the other. Both apply
// on top of whatever the bubble would otherwise look like, so the row
// still reads as the same message the circle saw. `leading` is a slot
// before the avatar (the circle's report-selection checkbox) and
// `trailing` one beside the bubble (its report-this-message button);
// `onReportFalsePositive` is optional for the same reason — a reviewer
// reading a transcript has no "that's my message" action.
export const MessageRow = memo(function MessageRow({
  message,
  member,
  isOwn,
  timeZone,
  onReportFalsePositive,
  isReported = false,
  highlight = false,
  highlightLabel,
  leading,
  trailing,
  className,
  onRowClick,
  t,
}: {
  message: ChatMessage
  member: Member
  isOwn: boolean
  timeZone: string
  onReportFalsePositive?: (messageId: string) => void
  isReported?: boolean
  highlight?: boolean
  highlightLabel?: string
  leading?: ReactNode
  trailing?: ReactNode
  className?: string
  // Whole-row click target (the circle's selection mode, where tapping a
  // message toggles its checkbox). Skipped when the click is actually a
  // text selection, so copying a quote out of a message doesn't flip it.
  onRowClick?: () => void
  t: TFunction<'session'>
}) {
  const isWithheld = isOwn && message.moderationStatus !== 'pass'
  const alreadyReported = isReported || message.falsePositiveReportedAt !== null

  return (
    <div
      className={className}
      style={{ display: 'flex', gap: 10, maxWidth: 560 }}
      onClick={
        onRowClick
          ? () => {
              if (window.getSelection()?.toString()) return
              onRowClick()
            }
          : undefined
      }
    >
      {leading}
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
          {highlightLabel && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--signal-urgent)', fontWeight: 'var(--font-weight-medium)' as unknown as number }}>
              {highlightLabel}
            </span>
          )}
        </span>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <div
            style={{
              background: isWithheld ? 'var(--signal-urgent-surface)' : isOwn ? 'var(--accent-safe-surface)' : 'var(--surface-raised)',
              border: isWithheld ? '0.5px solid var(--signal-urgent)' : '0.5px solid var(--border-subtle)',
              boxShadow: highlight ? '0 0 0 2px var(--signal-urgent)' : undefined,
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
          {isWithheld && !alreadyReported && onReportFalsePositive && (
            <IconButton
              icon={FlagIcon}
              label={t('composer.reportFalsePositive')}
              variant="urgent"
              onClick={() => onReportFalsePositive(message.id)}
            />
          )}
          {trailing}
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
export const JoinEventRow = memo(function JoinEventRow({
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
export function formatMessageTimestamp(iso: string, timeZone: string): string {
  const sent = new Date(iso)
  const now = new Date()
  const isToday = dateKeyInZone(sent, timeZone) === dateKeyInZone(now, timeZone)
  const time = sent.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone })
  if (isToday) return time
  const date = sent.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone })
  return `${date}, ${time}`
}
