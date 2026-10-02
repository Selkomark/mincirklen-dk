import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from '../../components/Alert'
import { Badge, type BadgeVariant } from '../../components/Badge'
import { Button } from '../../components/Button'
import { CopyText } from '../../components/CopyText'
import { Modal } from '../../components/Modal'
import { Select, SelectItem } from '../../components/Select'
import { Skeleton } from '../../components/Skeleton'
import { Stat } from '../../components/Stat'
import { Table } from '../../components/Table'
import { Tab, TabList, TabPanel, Tabs } from '../../components/Tabs'
import { Text } from '../../components/Text'
import { TextField } from '../../components/TextField'
import { Textarea } from '../../components/Textarea'
import { getTrpc, postTrpc } from './manageShared'
import './EmailsTab.css'

// Mirrors packages/shared/src/schemas/email.ts — this app isn't in the Bun
// workspace, so the unions are kept in sync by hand like the other tabs.
type EmailStatus = 'queued' | 'sent' | 'accepted' | 'delayed' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed' | 'suppressed' | 'complained'
const EMAIL_STATUSES: EmailStatus[] = ['queued', 'sent', 'accepted', 'delayed', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'suppressed', 'complained']
type EmailLanguage = 'en' | 'sv' | 'da'

interface EmailMessage {
  id: string
  templateKey: string
  language: EmailLanguage
  toEmailMasked: string
  toEmail: string | null
  userId: string | null
  subject: string
  status: EmailStatus
  provider: 'log' | 'ahasend'
  providerMessageId: string | null
  error: string | null
  isTest: boolean
  createdAt: string
  sentAt: string | null
  lastEventAt: string | null
}

interface EmailMessageDetail extends EmailMessage {
  variables: Record<string, unknown>
}

interface EmailEvent {
  id: string
  type: string
  occurredAt: string
  data: Record<string, unknown>
}

interface EmailStats {
  windowDays: number
  sent: number
  delivered: number
  bounced: number
  opened: number
  complained: number
}

interface EmailSuppression {
  id: string
  recipientMasked: string
  sendingDomain: string
  reason: string | null
  expiresAt: string | null
  createdAt: string
}

interface TemplateSummary {
  key: string
  description: string
  sampleVariables: Record<string, unknown>
}

interface RenderedEmail {
  subject: string
  html: string
  text: string
}

const PAGE_SIZE = 50

function statusVariant(status: EmailStatus): BadgeVariant {
  switch (status) {
    case 'delivered':
    case 'opened':
    case 'clicked':
      return 'safe'
    case 'bounced':
    case 'failed':
    case 'suppressed':
    case 'complained':
      return 'urgent'
    case 'queued':
    case 'sent':
    case 'accepted':
    case 'delayed':
      return 'info'
  }
}

function eventVariant(type: string): BadgeVariant {
  if (/bounced|failed|complained|suppressed|dns_error/.test(type)) return 'urgent'
  if (/delivered|opened|clicked/.test(type)) return 'safe'
  return 'info'
}

// What an event carried worth showing under the badge — bounce reasons,
// the clicked link, the client that opened it. Keys the provider uses.
function eventDetail(data: Record<string, unknown>): string | null {
  const pick = (...keys: string[]) => keys.map((k) => data[k]).find((v) => typeof v === 'string' && v.length > 0) as string | undefined
  const parts = [pick('type'), pick('reason', 'summary', 'error', 'description'), pick('url'), pick('feedback_type')]
  const client = data.client && typeof data.client === 'object' ? (data.client as Record<string, unknown>).name : undefined
  const os = data.os && typeof data.os === 'object' ? (data.os as Record<string, unknown>).name : undefined
  if (typeof client === 'string' || typeof os === 'string') parts.push([client, os].filter(Boolean).join(' · '))
  const detail = parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' — ')
  return detail.length > 0 ? detail : null
}

function Preview({ rendered, mode }: { rendered: RenderedEmail; mode: 'html' | 'text' }) {
  const { t } = useTranslation('console')
  if (mode === 'text') return <pre className="emails-preview--text">{rendered.text}</pre>
  return <iframe className="emails-preview" sandbox="" srcDoc={rendered.html} title={t('emails.preview.frameTitle')} />
}

function PreviewModeToggle({ mode, onChange }: { mode: 'html' | 'text'; onChange: (m: 'html' | 'text') => void }) {
  const { t } = useTranslation('console')
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <Button variant={mode === 'html' ? 'secondary' : 'ghost'} onPress={() => onChange('html')}>
        {t('emails.preview.html')}
      </Button>
      <Button variant={mode === 'text' ? 'secondary' : 'ghost'} onPress={() => onChange('text')}>
        {t('emails.preview.text')}
      </Button>
    </div>
  )
}

// One sent email: what it was, who it went to, and everything the
// provider has reported about it since. Preview re-renders from the
// stored template key and variables — the body itself is never stored.
function MessageModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation('console')
  const [detail, setDetail] = useState<{ message: EmailMessageDetail; events: EmailEvent[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendered, setRendered] = useState<RenderedEmail | null>(null)
  const [previewPending, setPreviewPending] = useState(false)
  const [mode, setMode] = useState<'html' | 'text'>('html')

  useEffect(() => {
    getTrpc<{ message: EmailMessageDetail; events: EmailEvent[] }>('emails.get', { id })
      .then(setDetail)
      .catch(() => setError(t('emails.loadFailed')))
  }, [id, t])

  const preview = async () => {
    if (!detail) return
    setPreviewPending(true)
    try {
      setRendered(
        await getTrpc<RenderedEmail>('emails.templates.preview', {
          templateKey: detail.message.templateKey,
          language: detail.message.language,
          variables: detail.message.variables,
        }),
      )
    } catch {
      setError(t('emails.previewFailed'))
    } finally {
      setPreviewPending(false)
    }
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : '—')

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title={t('emails.detail.title')} className="emails-detail-modal">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {error && <Alert variant="urgent">{error}</Alert>}
        {!detail ? (
          <Skeleton height={120} />
        ) : (
          <>
            <dl className="emails-meta">
              <dt>{t('emails.columns.recipient')}</dt>
              <dd>
                <CopyText value={detail.message.toEmail ?? detail.message.toEmailMasked} copyLabel={t('users.copy')} copiedLabel={t('users.copied')}>
                  {detail.message.toEmail ?? detail.message.toEmailMasked}
                </CopyText>
              </dd>
              <dt>{t('emails.columns.template')}</dt>
              <dd>
                {t(`emails.templateNames.${detail.message.templateKey}`, { defaultValue: detail.message.templateKey })}{' '}
                <span style={{ color: 'var(--text-secondary)' }}>· {t(`emails.languages.${detail.message.language}`)}</span>
                {detail.message.isTest && (
                  <>
                    {' '}
                    <Badge variant="neutral">{t('emails.testBadge')}</Badge>
                  </>
                )}
              </dd>
              <dt>{t('emails.columns.subject')}</dt>
              <dd>{detail.message.subject}</dd>
              <dt>{t('emails.columns.status')}</dt>
              <dd>
                <Badge variant={statusVariant(detail.message.status)}>{t(`emails.status.${detail.message.status}`)}</Badge>
                {detail.message.error && <span style={{ marginLeft: 'var(--space-2)', color: 'var(--text-secondary)' }}>{detail.message.error}</span>}
              </dd>
              <dt>{t('emails.detail.created')}</dt>
              <dd>{fmt(detail.message.createdAt)}</dd>
              <dt>{t('emails.detail.sent')}</dt>
              <dd>{fmt(detail.message.sentAt)}</dd>
              {detail.message.providerMessageId && (
                <>
                  <dt>{t('emails.detail.providerId')}</dt>
                  <dd>
                    <CopyText copyLabel={t('users.copy')} copiedLabel={t('users.copied')}>{detail.message.providerMessageId}</CopyText>
                  </dd>
                </>
              )}
              {detail.message.userId && (
                <>
                  <dt>{t('emails.detail.member')}</dt>
                  <dd>
                    <CopyText copyLabel={t('users.copy')} copiedLabel={t('users.copied')}>{detail.message.userId}</CopyText>
                  </dd>
                </>
              )}
            </dl>

            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>
                {t('emails.detail.events')}
              </div>
              {detail.events.length === 0 ? (
                <Text variant="muted" style={{ margin: 0 }}>
                  {t('emails.detail.noEvents')}
                </Text>
              ) : (
                <ol className="emails-timeline">
                  {detail.events.map((event) => {
                    const info = eventDetail(event.data)
                    return (
                      <li key={event.id} className="emails-timeline__item">
                        <Badge variant={eventVariant(event.type)}>{t(`emails.events.${event.type}`, { defaultValue: event.type })}</Badge>
                        <div>
                          <div className="emails-timeline__when">{fmt(event.occurredAt)}</div>
                          {info && <div className="emails-timeline__detail">{info}</div>}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <Button variant="secondary" isPending={previewPending} onPress={() => void preview()}>
                {rendered ? t('emails.preview.refresh') : t('emails.preview.open')}
              </Button>
              {rendered && <PreviewModeToggle mode={mode} onChange={setMode} />}
            </div>
            {rendered && (
              <>
                <Text variant="muted" style={{ margin: 0 }}>
                  {t('emails.preview.subject', { subject: rendered.subject })}
                </Text>
                <Preview rendered={rendered} mode={mode} />
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function SentPanel({ canReadStats }: { canReadStats: boolean }) {
  const { t, i18n } = useTranslation('console')
  const [stats, setStats] = useState<EmailStats | null>(null)
  const [status, setStatus] = useState<EmailStatus | 'all'>('all')
  const [messages, setMessages] = useState<EmailMessage[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    if (!canReadStats) return
    getTrpc<EmailStats>('emails.stats', undefined)
      .then(setStats)
      .catch(() => setStats(null))
  }, [canReadStats])

  const load = useCallback(
    async (cursor: string | null) => {
      try {
        const page = await getTrpc<{ messages: EmailMessage[]; nextCursor: string | null }>('emails.list', {
          ...(status === 'all' ? {} : { status }),
          ...(cursor ? { cursor } : {}),
          limit: PAGE_SIZE,
        })
        setMessages((prev) => (cursor && prev ? [...prev, ...page.messages] : page.messages))
        setNextCursor(page.nextCursor)
        setError(null)
      } catch {
        setError(t('emails.loadFailed'))
      }
    },
    [status, t],
  )

  useEffect(() => {
    setMessages(null)
    void load(null)
  }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {stats && (
        <div className="emails-stats">
          <Stat value={stats.sent} label={t('emails.stats.sent', { days: stats.windowDays })} />
          <Stat value={stats.delivered} label={t('emails.stats.delivered')} />
          <Stat value={stats.opened} label={t('emails.stats.opened')} />
          <Stat value={stats.bounced} label={t('emails.stats.bounced')} />
          <Stat value={stats.complained} label={t('emails.stats.complained')} />
        </div>
      )}

      <div className="emails-filter">
        <Select label={t('emails.filter.status')} selectedKey={status} onSelectionChange={(key) => setStatus(key as EmailStatus | 'all')}>
          <SelectItem id="all">{t('emails.filter.allStatuses')}</SelectItem>
          {EMAIL_STATUSES.map((s) => (
            <SelectItem key={s} id={s}>
              {t(`emails.status.${s}`)}
            </SelectItem>
          ))}
        </Select>
      </div>

      {error && <Alert variant="urgent">{error}</Alert>}

      {messages === null ? (
        <Skeleton height={160} />
      ) : messages.length === 0 ? (
        <Text variant="muted" style={{ margin: 0 }}>
          {t('emails.empty')}
        </Text>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <Table striped>
            <thead>
              <tr>
                <th>{t('emails.columns.when')}</th>
                <th>{t('emails.columns.recipient')}</th>
                <th>{t('emails.columns.template')}</th>
                <th>{t('emails.columns.subject')}</th>
                <th>{t('emails.columns.status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(m.createdAt).toLocaleString(i18n.language)}</td>
                  <td>
                    <CopyText value={m.toEmail ?? m.toEmailMasked} copyLabel={t('users.copy')} copiedLabel={t('users.copied')}>
                      {m.toEmail ?? m.toEmailMasked}
                    </CopyText>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {t(`emails.templateNames.${m.templateKey}`, { defaultValue: m.templateKey })}
                    {m.isTest && (
                      <>
                        {' '}
                        <Badge variant="neutral">{t('emails.testBadge')}</Badge>
                      </>
                    )}
                  </td>
                  <td style={{ maxWidth: 320 }}>{m.subject}</td>
                  <td>
                    <Badge variant={statusVariant(m.status)}>{t(`emails.status.${m.status}`)}</Badge>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Button variant="ghost" onPress={() => setOpen(m.id)}>
                      {t('common.view')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {nextCursor && (
        <div>
          <Button
            variant="ghost"
            isPending={loadingMore}
            onPress={() => {
              setLoadingMore(true)
              void load(nextCursor).finally(() => setLoadingMore(false))
            }}
          >
            {t('common.loadMore')}
          </Button>
        </div>
      )}

      {open && <MessageModal id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

// A template with its language and variables editable, the preview
// beside it, and (for emails.send_test holders) a test send.
function TemplateModal({ template, languages, canSendTest, onClose }: { template: TemplateSummary; languages: EmailLanguage[]; canSendTest: boolean; onClose: () => void }) {
  const { t } = useTranslation('console')
  const [language, setLanguage] = useState<EmailLanguage>('en')
  const [variablesText, setVariablesText] = useState(() => JSON.stringify(template.sampleVariables, null, 2))
  const [rendered, setRendered] = useState<RenderedEmail | null>(null)
  const [mode, setMode] = useState<'html' | 'text'>('html')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ kind: 'safe' | 'urgent'; text: string } | null>(null)

  const variables = useMemo<{ value: Record<string, unknown> | null; error: boolean }>(() => {
    try {
      const parsed: unknown = JSON.parse(variablesText)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { value: parsed as Record<string, unknown>, error: false } : { value: null, error: true }
    } catch {
      return { value: null, error: true }
    }
  }, [variablesText])

  useEffect(() => {
    if (variables.error || !variables.value) {
      setPreviewError(t('emails.templates.invalidJson'))
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      getTrpc<RenderedEmail>('emails.templates.preview', { templateKey: template.key, language, variables: variables.value })
        .then((r) => {
          if (cancelled) return
          setRendered(r)
          setPreviewError(null)
        })
        .catch(() => {
          if (!cancelled) setPreviewError(t('emails.templates.previewRejected'))
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [template.key, language, variables, t])

  const sendTest = async () => {
    if (!variables.value) return
    setSending(true)
    setSendResult(null)
    try {
      const outcome = await postTrpc<{ status: string }>('emails.sendTest', { templateKey: template.key, language, to: to.trim(), variables: variables.value })
      setSendResult(
        outcome.status === 'sent'
          ? { kind: 'safe', text: t('emails.templates.sent', { to: to.trim() }) }
          : { kind: 'urgent', text: t('emails.templates.sendOutcome', { status: t(`emails.sendOutcome.${outcome.status}`, { defaultValue: outcome.status }) }) },
      )
    } catch {
      setSendResult({ kind: 'urgent', text: t('emails.templates.sendFailed') })
    } finally {
      setSending(false)
    }
  }

  const canSend = canSendTest && !variables.error && /\S+@\S+\.\S+/.test(to.trim())

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title={t(`emails.templateNames.${template.key}`, { defaultValue: template.key })} className="emails-template-modal">
      <div className="emails-template">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Text variant="muted" style={{ margin: 0 }}>
            {template.description}
          </Text>
          <Select label={t('emails.templates.language')} selectedKey={language} onSelectionChange={(key) => setLanguage(key as EmailLanguage)}>
            {languages.map((l) => (
              <SelectItem key={l} id={l}>
                {t(`emails.languages.${l}`)}
              </SelectItem>
            ))}
          </Select>
          <Textarea label={t('emails.templates.variables')} hint={t('emails.templates.variablesHint')} value={variablesText} onChange={(e) => setVariablesText(e.target.value)} rows={8} spellCheck={false} />
          {canSendTest && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-subtle)' }}>
              <TextField label={t('emails.templates.to')} type="email" inputMode="email" placeholder={t('emails.templates.toPlaceholder')} value={to} onChange={(e) => setTo(e.target.value)} />
              <div>
                <Button variant="safe" isPending={sending} isDisabled={!canSend} onPress={() => void sendTest()}>
                  {t('emails.templates.send')}
                </Button>
              </div>
              {sendResult && <Alert variant={sendResult.kind}>{sendResult.text}</Alert>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Text variant="muted" as="span" style={{ margin: 0 }}>
              {rendered ? t('emails.preview.subject', { subject: rendered.subject }) : t('common.loading')}
            </Text>
            <PreviewModeToggle mode={mode} onChange={setMode} />
          </div>
          {previewError && <Alert variant="urgent">{previewError}</Alert>}
          {rendered ? <Preview rendered={rendered} mode={mode} /> : <Skeleton height={420} />}
        </div>
      </div>
    </Modal>
  )
}

function TemplatesPanel({ canSendTest }: { canSendTest: boolean }) {
  const { t } = useTranslation('console')
  const [catalog, setCatalog] = useState<{ templates: TemplateSummary[]; languages: EmailLanguage[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<TemplateSummary | null>(null)

  useEffect(() => {
    getTrpc<{ templates: TemplateSummary[]; languages: EmailLanguage[] }>('emails.templates.list', undefined)
      .then(setCatalog)
      .catch(() => setError(t('emails.loadFailed')))
  }, [t])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Text variant="muted" style={{ margin: 0 }}>
        {t('emails.templates.intro')}
      </Text>
      {error && <Alert variant="urgent">{error}</Alert>}
      {!catalog ? (
        <Skeleton height={160} />
      ) : (
        <div className="emails-template-list">
          {catalog.templates.map((template) => (
            <button key={template.key} type="button" className="emails-template-entry" onClick={() => setOpen(template)}>
              <span style={{ fontWeight: 'var(--font-weight-medium)' }}>{t(`emails.templateNames.${template.key}`, { defaultValue: template.key })}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{template.description}</span>
              <span className="emails-template-entry__key">{template.key}</span>
            </button>
          ))}
        </div>
      )}
      {open && catalog && <TemplateModal template={open} languages={catalog.languages} canSendTest={canSendTest} onClose={() => setOpen(null)} />}
    </div>
  )
}

function SuppressionsPanel() {
  const { t, i18n } = useTranslation('console')
  const [rows, setRows] = useState<EmailSuppression[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(
    async (cursor: string | null) => {
      try {
        const page = await getTrpc<{ suppressions: EmailSuppression[]; nextCursor: string | null }>('emails.suppressions.list', { ...(cursor ? { cursor } : {}), limit: PAGE_SIZE })
        setRows((prev) => (cursor && prev ? [...prev, ...page.suppressions] : page.suppressions))
        setNextCursor(page.nextCursor)
      } catch {
        setError(t('emails.loadFailed'))
      }
    },
    [t],
  )

  useEffect(() => {
    void load(null)
  }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Text variant="muted" style={{ margin: 0 }}>
        {t('emails.suppressions.intro')}
      </Text>
      {error && <Alert variant="urgent">{error}</Alert>}
      {rows === null ? (
        <Skeleton height={120} />
      ) : rows.length === 0 ? (
        <Text variant="muted" style={{ margin: 0 }}>
          {t('emails.suppressions.empty')}
        </Text>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <Table striped>
            <thead>
              <tr>
                <th>{t('emails.columns.recipient')}</th>
                <th>{t('emails.suppressions.columns.domain')}</th>
                <th>{t('emails.suppressions.columns.reason')}</th>
                <th>{t('emails.suppressions.columns.expires')}</th>
                <th>{t('emails.suppressions.columns.added')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>{s.recipientMasked}</td>
                  <td>{s.sendingDomain || '—'}</td>
                  <td>{s.reason ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{s.expiresAt ? new Date(s.expiresAt).toLocaleString(i18n.language) : t('emails.suppressions.never')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(s.createdAt).toLocaleString(i18n.language)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {nextCursor && (
        <div>
          <Button
            variant="ghost"
            isPending={loadingMore}
            onPress={() => {
              setLoadingMore(true)
              void load(nextCursor).finally(() => setLoadingMore(false))
            }}
          >
            {t('common.loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}

export function EmailsTab({ canSendTest }: { canSendTest: boolean }) {
  const { t } = useTranslation('console')
  return (
    <Tabs defaultSelectedKey="sent">
      <TabList aria-label={t('emails.tabsLabel')}>
        <Tab id="sent">{t('emails.tabs.sent')}</Tab>
        <Tab id="templates">{t('emails.tabs.templates')}</Tab>
        <Tab id="suppressions">{t('emails.tabs.suppressions')}</Tab>
      </TabList>
      <TabPanel id="sent">
        <SentPanel canReadStats />
      </TabPanel>
      <TabPanel id="templates">
        <TemplatesPanel canSendTest={canSendTest} />
      </TabPanel>
      <TabPanel id="suppressions">
        <SuppressionsPanel />
      </TabPanel>
    </Tabs>
  )
}
