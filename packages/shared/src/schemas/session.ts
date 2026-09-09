import { z } from 'zod'

export const sessionStatusSchema = z.enum(['forming', 'active', 'completed', 'cancelled'])

export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const sessionSchema = z.object({
  id: z.string().uuid(),
  status: sessionStatusSchema,
  createdAt: z.coerce.date(),
  startedAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
  // turnClaimedAt is deliberately not exposed here — internal concurrency
  // control, not client-facing.
  currentTurnUserId: z.string().uuid().nullable(),
  // Null for sessions created through the pre-existing ad-hoc turn-based
  // flow — only circles created via /start/new populate these.
  topicId: z.string().uuid().nullable(),
  name: z.string().nullable(),
  scheduledAt: z.coerce.date().nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  capacity: z.number().int().positive().nullable(),
})

export type Session = z.infer<typeof sessionSchema>

// Client-supplied fields for the scheduled-circle creation flow
// (StartNewPage.tsx). `durationMinutes: null` means "open-ended". Fields
// are a partial, all-or-nothing group rather than plainly required so
// `session.create` stays backward compatible with the pre-existing
// ad-hoc turn-based flow, which posts no body (received here as `{}`) —
// see sessionRouter.ts's `create` procedure.
export const createSessionInputSchema = z
  .object({
    topicId: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    scheduledAt: z.string().datetime(),
    durationMinutes: z.number().int().positive().nullable(),
    capacity: z.number().int().positive(),
  })
  .partial()
  .refine(
    (v) =>
      (v.topicId === undefined && v.name === undefined && v.scheduledAt === undefined && v.capacity === undefined) ||
      (v.topicId !== undefined && v.name !== undefined && v.scheduledAt !== undefined && v.capacity !== undefined),
    { message: 'topicId, name, scheduledAt, and capacity must all be provided together, or all omitted' },
  )
  // Circles can only be scheduled up to a week out — keeps the browse
  // list's "now"-anchored view (StartJoinPage.tsx) from having to
  // account for an unbounded future tail.
  .refine((v) => v.scheduledAt === undefined || new Date(v.scheduledAt).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000, {
    message: 'scheduledAt must be within the next 7 days',
    path: ['scheduledAt'],
  })
  .transform((v): { scheduled: false } | ({ scheduled: true } & Required<typeof v>) =>
    v.topicId === undefined ? { scheduled: false } : { scheduled: true, ...(v as Required<typeof v>) },
  )

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>

// Server-side filters + cursor pagination for browsing open circles
// (StartJoinPage.tsx) — replaces client-side in-memory filtering, which
// doesn't scale past a handful of rows. `cursor` is opaque to the
// client: it's whatever `nextCursor`/`prevCursor` a previous response
// returned, passed back verbatim. `durationMinutes: null` filters for
// open-ended circles specifically (as opposed to omitting the field,
// which means "any duration"). `direction` backs the windowed browse
// list's backward paging — see sessionRepository.ts's listOpenSessions.
export const listOpenSessionsInputSchema = z.object({
  search: z.string().trim().max(100).optional(),
  topicId: z.string().uuid().optional(),
  capacity: z.number().int().positive().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  cursor: z.string().optional(),
  direction: z.enum(['after', 'before']).default('after'),
  limit: z.number().int().min(1).max(50).default(20),
})

export type ListOpenSessionsInput = z.infer<typeof listOpenSessionsInputSchema>

// The dashboard sidebar's "recent sessions" list (SessionPage.tsx) —
// forward-only "load more" pagination, not the bidirectional windowed
// scroll listOpenSessionsInputSchema backs, and no topic/date/duration/
// capacity filters (this is a personal history list, not a browse/search
// surface over every open circle) — just free-text search, same
// semantics as /start/join's.
export const listRecentVisitsInputSchema = z.object({
  search: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
})

export type ListRecentVisitsInput = z.infer<typeof listRecentVisitsInputSchema>
