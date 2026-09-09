import { z } from 'zod'

// 'reviewed_pass' is distinct from 'pass' on purpose — it means a human
// reviewed a flag/crisis message and determined it wasn't warranted, not
// that the classifier originally said pass. See
// packages/shared/migrations/0001_init.ts and
// services/trpc-api/src/repositories/messageRepository.ts's listMessages
// for the visibility rule this drives (a non-'pass' row is only ever
// returned to its own author).
export const messageModerationStatusSchema = z.enum(['pass', 'flag', 'crisis', 'reviewed_pass'])

export type MessageModerationStatus = z.infer<typeof messageModerationStatusSchema>

export const messageSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
  body: z.string().min(1),
  type: z.enum(['user', 'system']),
  moderationStatus: messageModerationStatusSchema,
  falsePositiveReportedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
})

export type Message = z.infer<typeof messageSchema>

// Unidirectional (no `direction`) — unlike listOpenSessionsInputSchema's
// bidirectional browse-list pagination, message history only ever needs
// "older than this cursor" (scrolling up); the newest end is never
// paginated, it arrives live over the WebSocket instead. Omitting the
// cursor entirely means "give me the latest page" — see
// messageRepository.ts's listMessages for how that's implemented as the
// same query as any other page, not a special case.
export const listMessagesInputSchema = z.object({
  sessionId: z.string().uuid(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
})

export type ListMessagesInput = z.infer<typeof listMessagesInputSchema>
