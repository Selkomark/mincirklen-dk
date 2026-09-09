import { useState } from 'react'
import { getLocalTimeZone, today, type CalendarDate, type Time } from '@internationalized/date'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Checkbox } from '../../components/Checkbox'
import { TextField } from '../../components/TextField'
import { Alert } from '../../components/Alert'
import { DatePicker } from '../../components/DatePicker'
import { TimePicker } from '../../components/TimePicker'
import { Skeleton } from '../../components/Skeleton'
import { publicPagePath } from '../../publicPages/pages'
import { SiteHeader } from '../../SiteHeader'
import { SiteFooter } from '../../SiteFooter'
import { useDocumentTitle } from '../../useDocumentTitle'
import { Chip, DURATIONS, SIZES, StepBar, durationLabel, useTopics } from './shared'

export interface StartNewPageProps {
  onBack: () => void
  onComplete: (sessionId: string) => void
  // SessionPage.tsx's "New session" opens this same flow in a Modal
  // (alongside StartJoinPage, as a second tab) instead of navigating to
  // the /start/new route — embedded skips the full-page chrome
  // (SiteHeader/SiteFooter, the centered/padded page wrapper) and just
  // renders the step content, since the Modal already provides its own
  // dialog chrome. Mirrors StartJoinPage.tsx's identical `embedded` prop.
  embedded?: boolean
}

function combineToISOString(date: CalendarDate, time: Time): string {
  return new Date(date.year, date.month - 1, date.day, time.hour, time.minute).toISOString()
}

export function StartNewPage({ onBack, onComplete, embedded = false }: StartNewPageProps) {
  const { t } = useTranslation('start')
  useDocumentTitle(t('newPage.documentTitle'))

  const { topics, loading: topicsLoading, error: topicsError } = useTopics()

  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [topicId, setTopicId] = useState<string | null>(null)
  const [sizeId, setSizeId] = useState<string | null>(null)
  const [createDate, setCreateDate] = useState<CalendarDate | null>(null)
  const [createTime, setCreateTime] = useState<Time | null>(null)
  const [createDuration, setCreateDuration] = useState<string | null>(null)

  const [anonChecked, setAnonChecked] = useState(false)
  const [guidelinesChecked, setGuidelinesChecked] = useState(false)
  const [termsChecked, setTermsChecked] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const selectedTopic = topics.find((topic) => topic.id === topicId)
  const createIncomplete = !name.trim() || !topicId || !sizeId || !createDate || !createTime || !createDuration
  const confirmDisabled = !anonChecked || !guidelinesChecked || !termsChecked

  async function confirm() {
    if (!name.trim() || !topicId || !createDate || !createTime || !createDuration || !sizeId) return

    setSubmitError(null)
    setIsSubmitting(true)
    try {
      const capacity = SIZES.find((sz) => sz.id === sizeId)!.capacity
      const durationMinutes = DURATIONS.find((d) => d.id === createDuration)!.minutes

      const createRes = await fetch('/api/trpc/session.create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topicId,
          name: name.trim(),
          scheduledAt: combineToISOString(createDate, createTime),
          durationMinutes,
          capacity,
        }),
      })
      if (!createRes.ok) {
        throw new Error(t('newPage.createFailed'))
      }
      const { result } = (await createRes.json()) as { result: { data: { id: string } } }
      const sessionId = result.data.id

      const joinRes = await fetch('/api/trpc/session.join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (!joinRes.ok) {
        throw new Error(t('newPage.createdButJoinFailed'))
      }

      onComplete(sessionId)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('newPage.createFailed'))
      setIsSubmitting(false)
    }
  }

  const stepBody = (
    <>
      {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
                    {t('newPage.title')}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>{t('newPage.subtitle')}</div>
                </div>

                {topicsError && <Alert variant="urgent">{topicsError}</Alert>}

                <TextField
                  label={t('newPage.circleName')}
                  hint={t('newPage.circleNameHint')}
                  placeholder={t('newPage.circleNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
                    {t('newPage.topic')}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {topicsLoading &&
                      Array.from({ length: 6 }, (_, i) => (
                        <Skeleton key={i} width={72 + (i % 3) * 20} height={32} radius="var(--radius-full)" />
                      ))}
                    {topics.map((topic) => (
                      <Chip key={topic.id} label={topic.label} active={topic.id === topicId} onClick={() => setTopicId(topic.id)} />
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
                    {t('newPage.dateAndTime')}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <DatePicker
                      aria-label={t('newPage.date')}
                      openCalendarLabel={t('shared.openCalendar')}
                      value={createDate}
                      onChange={setCreateDate}
                      minValue={today(getLocalTimeZone())}
                      maxValue={today(getLocalTimeZone()).add({ days: 7 })}
                      style={{ flex: '1 1 200px' }}
                    />
                    <TimePicker aria-label={t('newPage.time')} value={createTime} onChange={setCreateTime} style={{ flex: '1 1 160px' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
                    {t('newPage.length')}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {DURATIONS.map((d) => (
                      <Chip key={d.id} label={durationLabel(d.id, t)} active={d.id === createDuration} onClick={() => setCreateDuration(d.id)} />
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
                    {t('newPage.groupSize')}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {SIZES.map((sz) => (
                      <Chip key={sz.id} label={t('sizes.upTo', { count: sz.capacity })} active={sz.id === sizeId} onClick={() => setSizeId(sz.id)} />
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <Button variant="ghost" onClick={onBack}>
                    {embedded ? t('newPage.cancel') : t('newPage.back')}
                  </Button>
                  <Button variant="safe" isDisabled={createIncomplete} onClick={() => setStep(2)}>
                    {t('newPage.continue')}
                  </Button>
                </div>
              </div>
            )}

            {step === 2 && selectedTopic && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
                    {t('newPage.beforeYouBegin')}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>
                    {t('newPage.startingName', { name: name.trim() })}
                  </div>
                </div>

                <Alert variant="safe">{t('newPage.anonymousNote')}</Alert>

                {submitError && <Alert variant="urgent">{submitError}</Alert>}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                    <Checkbox isSelected={anonChecked} onChange={setAnonChecked} />
                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{t('newPage.understandAnonymous')}</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                    <Checkbox isSelected={guidelinesChecked} onChange={setGuidelinesChecked} />
                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                      {t('newPage.agreeToThePrefix')}{' '}
                      <a href={publicPagePath('community-guidelines')} target="_blank" rel="noopener noreferrer" className="ds-inline-link">
                        {t('newPage.communityGuidelines')}
                      </a>
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                    <Checkbox isSelected={termsChecked} onChange={setTermsChecked} />
                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                      {t('newPage.agreeToThePrefix')}{' '}
                      <a href={publicPagePath('terms-and-conditions')} target="_blank" rel="noopener noreferrer" className="ds-inline-link">
                        {t('newPage.termsOfService')}
                      </a>{' '}
                      {t('newPage.liabilityNote')}
                    </span>
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    {t('newPage.back')}
                  </Button>
                  <Button variant="safe" isPending={isSubmitting} isDisabled={confirmDisabled} onClick={confirm}>
                    {t('newPage.startCircle')}
                  </Button>
                </div>
              </div>
            )}
    </>
  )

  if (embedded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <StepBar step={step} total={2} />
        {stepBody}
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
          <StepBar step={step} total={2} />

          <div style={{ background: 'var(--surface-raised)', border: '0.5px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'clamp(20px, 4vw, 32px)' }}>
            {stepBody}
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
