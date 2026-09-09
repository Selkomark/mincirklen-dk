import { useEffect, useRef, useState } from 'react'
import type { CalendarDate } from '@internationalized/date'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Alert } from '../../components/Alert'
import { DatePicker } from '../../components/DatePicker'
import { Skeleton } from '../../components/Skeleton'
import { Spinner } from '../../components/Spinner'
import { ScrollHint } from '../../components/ScrollHint'
import { Select, SelectItem } from '../../components/Select'
import './StartJoinPage.css'
import { SiteHeader } from '../../SiteHeader'
import { SiteFooter } from '../../SiteFooter'
import { useDocumentTitle } from '../../useDocumentTitle'
import { useScrollShiftCompensation } from '../../hooks/useScrollShiftCompensation'
import { usePreferences } from '../../PreferencesProvider'
import {
  DURATIONS,
  HighlightedText,
  SIZES,
  describeTiming,
  displayName,
  durationLabel,
  useOpenSessions,
  useTopics,
} from './shared'

export interface StartJoinPageProps {
  onBack: () => void
  onComplete: (sessionId: string) => void
  // SessionPage.tsx's "New session" opens this same flow in a Modal
  // instead of navigating to the /start/join route — embedded skips the
  // full-page chrome (SiteHeader/SiteFooter, the centered/padded page
  // wrapper) and just renders the step content, since the Modal already
  // provides its own dialog chrome.
  embedded?: boolean
}

function CircleRowSkeleton() {
  return (
    <div style={{ border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Skeleton width="60%" height={14} />
      <Skeleton width="40%" height={11} />
    </div>
  )
}

export function StartJoinPage({ onBack, onComplete, embedded = false }: StartJoinPageProps) {
  const { t } = useTranslation('start')
  useDocumentTitle(t('joinPage.documentTitle'))

  const { topics } = useTopics()
  const { effectiveTimeZone } = usePreferences()

  // Single step: picking a circle joins it immediately. The former
  // second step's consent checkboxes (anonymity/guidelines/terms) moved
  // to SessionPage.tsx's CommunityGuidelinesModal — the one gate that
  // covers every way of joining a circle (direct visit, this page, "New
  // session"), not a separate copy re-asked here. `joiningId` tracks
  // which row is mid-join, both for that row's own pending state and to
  // block clicking a different row while one is in flight.
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)

  const [searchText, setSearchText] = useState('')
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)

  // Draft values are what the panel's controls are bound to; they only
  // take effect once "Search" applies them below. The free-text search
  // box above the panel is unrelated — it stays live/debounced as the
  // user types (see useOpenSessions).
  const [draftDate, setDraftDate] = useState<CalendarDate | null>(null)
  const [draftDuration, setDraftDuration] = useState('')
  const [draftTopic, setDraftTopic] = useState('')
  const [draftSize, setDraftSize] = useState('')

  const [appliedDate, setAppliedDate] = useState<CalendarDate | null>(null)
  const [appliedDuration, setAppliedDuration] = useState('')
  const [appliedTopic, setAppliedTopic] = useState('')
  const [appliedSize, setAppliedSize] = useState('')

  const durationMinutesFilter = appliedDuration ? DURATIONS.find((d) => d.id === appliedDuration)!.minutes : undefined
  const capacityFilter = appliedSize ? SIZES.find((sz) => sz.id === appliedSize)?.capacity : undefined
  const {
    sessions,
    loadingInitial,
    loadingNext,
    loadingPrevious,
    error,
    hasNext,
    hasPrevious,
    loadNext,
    loadPrevious,
    topShiftVersion,
  } = useOpenSessions({
    search: searchText || undefined,
    topicId: appliedTopic || undefined,
    capacity: capacityFilter,
    durationMinutes: durationMinutesFilter,
    date: appliedDate ? appliedDate.toString() : undefined,
  })

  // Windowed infinite scroll (Instagram-feed style): the list keeps only
  // a bounded window of pages loaded (see useOpenSessions' MAX_WINDOW_PAGES) —
  // scrolling far enough in either direction evicts the far end and
  // re-fetches from the backend, rather than growing forever. Both
  // sentinels live inside the fixed-height scrollable panel, so each
  // observer's root is that panel, not the page viewport — otherwise a
  // sentinel would read as "visible" the moment the panel is merely
  // on-screen at all.
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const bottomSentinelRef = useRef<HTMLDivElement>(null)
  const { snapshotBeforeShift } = useScrollShiftCompensation(scrollContainerRef, topShiftVersion)

  function handleLoadNext() {
    snapshotBeforeShift()
    loadNext()
  }

  function handleLoadPrevious() {
    snapshotBeforeShift()
    loadPrevious()
  }

  useEffect(() => {
    const root = scrollContainerRef.current
    const sentinel = bottomSentinelRef.current
    if (!root || !sentinel || !hasNext) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) handleLoadNext()
      },
      { root, rootMargin: '80px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleLoadNext reads live refs, doesn't need to be a dependency
  }, [hasNext, sessions.length])

  useEffect(() => {
    const root = scrollContainerRef.current
    const sentinel = topSentinelRef.current
    if (!root || !sentinel || !hasPrevious) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) handleLoadPrevious()
      },
      { root, rootMargin: '80px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleLoadPrevious reads live refs, doesn't need to be a dependency
  }, [hasPrevious, sessions.length])

  async function joinCircle(id: string) {
    if (joiningId) return
    setJoinError(null)
    setJoiningId(id)
    try {
      const res = await fetch('/api/trpc/session.join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: id }),
      })

      if (!res.ok) {
        throw new Error(res.status === 409 ? t('joinPage.circleFilledUp') : t('joinPage.joinFailed'))
      }

      onComplete(id)
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : t('joinPage.joinFailed'))
      setJoiningId(null)
    }
  }

  function applyFilters() {
    setAppliedDate(draftDate)
    setAppliedDuration(draftDuration)
    setAppliedTopic(draftTopic)
    setAppliedSize(draftSize)
    setFilterPanelOpen(false)
  }

  function clearFilters() {
    setDraftDate(null)
    setDraftDuration('')
    setDraftTopic('')
    setDraftSize('')
    setAppliedDate(null)
    setAppliedDuration('')
    setAppliedTopic('')
    setAppliedSize('')
  }

  const hasFilters = !!(draftDate || draftDuration || draftTopic || draftSize || appliedDate || appliedDuration || appliedTopic || appliedSize)

  // The search/filter/list block — the actual "picking a circle" UI —
  // shared verbatim between the standalone /start/join page and the
  // embedded modal below. Everything *around* it (heading, card
  // background, page chrome) differs by context and is never shared, so
  // there's exactly one heading and one card border wherever this
  // renders, not one from this page nested inside another from the
  // Modal.
  const listBody = (
    <>
      <div style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="search"
                      className="ds-textfield__input"
                      placeholder={t('joinPage.searchPlaceholder')}
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      style={{ flex: 1, boxSizing: 'border-box' }}
                    />
                    <button
                      aria-label={t('joinPage.showFilters')}
                      onClick={() => setFilterPanelOpen((v) => !v)}
                      style={{
                        width: 40,
                        height: 40,
                        flex: 'none',
                        borderRadius: 'var(--radius-md)',
                        border: '0.5px solid var(--border-subtle)',
                        background: filterPanelOpen ? 'var(--accent-safe-surface)' : 'transparent',
                        color: filterPanelOpen ? 'var(--accent-safe)' : 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M2 3h12M4.5 8h7M7 13h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>

                  {filterPanelOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        right: 0,
                        zIndex: 20,
                        width: 320,
                        maxWidth: 'calc(100vw - 48px)',
                        boxSizing: 'border-box',
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: 8,
                        padding: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 130 }}>
                          <Select
                            className="start-join-filter-select"
                            label={t('joinPage.topic')}
                            selectedKey={draftTopic || 'any'}
                            onSelectionChange={(key) => setDraftTopic(key === 'any' ? '' : String(key))}
                          >
                            <SelectItem id="any">{t('joinPage.any')}</SelectItem>
                            {topics.map((topic) => (
                              <SelectItem key={topic.id} id={topic.id}>
                                {topic.label}
                              </SelectItem>
                            ))}
                          </Select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 100 }}>
                          <Select
                            className="start-join-filter-select"
                            label={t('joinPage.groupSize')}
                            selectedKey={draftSize || 'any'}
                            onSelectionChange={(key) => setDraftSize(key === 'any' ? '' : String(key))}
                          >
                            <SelectItem id="any">{t('joinPage.any')}</SelectItem>
                            {SIZES.map((sz) => (
                              <SelectItem key={sz.id} id={sz.id}>
                                {t('sizes.upTo', { count: sz.capacity })}
                              </SelectItem>
                            ))}
                          </Select>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <DatePicker
                            label={t('joinPage.date')}
                            openCalendarLabel={t('shared.openCalendar')}
                            value={draftDate}
                            onChange={setDraftDate}
                            style={{ width: 160, maxWidth: '100%' }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 90 }}>
                          <Select
                            className="start-join-filter-select"
                            label={t('joinPage.duration')}
                            selectedKey={draftDuration || 'any'}
                            onSelectionChange={(key) => setDraftDuration(key === 'any' ? '' : String(key))}
                          >
                            <SelectItem id="any">{t('joinPage.any')}</SelectItem>
                            {DURATIONS.map((d) => (
                              <SelectItem key={d.id} id={d.id}>
                                {durationLabel(d.id, t)}
                              </SelectItem>
                            ))}
                          </Select>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flex: 'none' }}>
                          {hasFilters && (
                            <button
                              onClick={clearFilters}
                              style={{ height: 30, padding: '0 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-primary)', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)', cursor: 'pointer' }}
                            >
                              {t('joinPage.clear')}
                            </button>
                          )}
                          <button
                            onClick={applyFilters}
                            style={{ height: 30, padding: '0 12px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--accent-safe)', color: 'var(--text-on-accent)', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)', cursor: 'pointer' }}
                          >
                            {t('joinPage.search')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {!loadingInitial && !error && sessions.length > 0 && hasPrevious && (
                  <ScrollHint direction="up" label={t('joinPage.scrollUpHint')} />
                )}

                <div ref={scrollContainerRef} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                  {loadingInitial &&
                    Array.from({ length: 3 }, (_, i) => <CircleRowSkeleton key={i} />)}
                  {error && <Alert variant="urgent">{error}</Alert>}
                  {joinError && <Alert variant="urgent">{joinError}</Alert>}
                  {!loadingInitial && !error && <div ref={topSentinelRef} style={{ height: 1, flexShrink: 0 }} />}
                  {!loadingInitial && loadingPrevious && <CircleRowSkeleton />}
                  {!loadingInitial && !error && sessions.map((s) => {
                    const { timing, badgeText, badgeVariant } = describeTiming(s, effectiveTimeZone, t)
                    const isJoiningThis = joiningId === s.id
                    return (
                      <div
                        key={s.id}
                        onClick={() => void joinCircle(s.id)}
                        aria-busy={isJoiningThis}
                        style={{
                          cursor: joiningId ? 'default' : 'pointer',
                          opacity: joiningId && !isJoiningThis ? 0.5 : 1,
                          pointerEvents: joiningId ? 'none' : 'auto',
                          border: `0.5px solid ${isJoiningThis ? 'var(--accent-safe)' : 'var(--border-subtle)'}`,
                          borderRadius: 8,
                          padding: 12,
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
                            <HighlightedText text={displayName(s)} query={searchText} />
                          </div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                            {/* s.joinedCount starts as the static DB join tally (first paint,
                                never blocked on a WS round trip) and is overlaid with the live
                                active-participant count once useOpenSessions' browse
                                subscription delivers one — see shared.tsx. */}
                            {t('joinPage.sessionMeta', {
                              timing,
                              duration: durationLabel(DURATIONS.find((d) => d.minutes === s.durationMinutes)?.id ?? 'open', t),
                              joined: s.joinedCount,
                              capacity: s.capacity,
                            })}
                          </div>
                        </div>
                        {isJoiningThis ? <Spinner size={16} /> : <Badge variant={badgeVariant}>{badgeText}</Badge>}
                      </div>
                    )
                  })}
                  {!loadingInitial && !error && sessions.length === 0 && (
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>
                      {t('joinPage.noMatches')}
                    </div>
                  )}
                  {loadingNext && <CircleRowSkeleton />}
                  <div ref={bottomSentinelRef} style={{ height: 1, flexShrink: 0 }} />
                </div>

      {!loadingInitial && !error && sessions.length > 0 && hasNext && (
        <ScrollHint direction="down" label={t('joinPage.scrollDownHint')} />
      )}
    </>
  )

  if (embedded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{t('joinPage.subtitle')}</div>
        {listBody}
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <Button variant="ghost" onClick={onBack}>
            {t('joinPage.cancel')}
          </Button>
        </div>
      </div>
    )
  }

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
          <div style={{ background: 'var(--surface-raised)', border: '0.5px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'clamp(20px, 4vw, 32px)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
                  {t('joinPage.title')}
                </div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>{t('joinPage.subtitle')}</div>
              </div>
              {listBody}
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <Button variant="ghost" onClick={onBack}>
                  {t('joinPage.back')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
