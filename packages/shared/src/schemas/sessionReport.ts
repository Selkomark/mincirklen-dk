import { z } from 'zod'

// Review of member-filed session reports (the /manage "Session reports"
// tab; services/trpc-api/src/controllers/sessionReportsRouter.ts). Filing
// a report itself goes through sessionRouter.ts's `report` procedure.
export const sessionReportStatusSchema = z.enum(['open', 'reviewed', 'dismissed'])
export type SessionReportStatus = z.infer<typeof sessionReportStatusSchema>

// A decision is open → one of these; `open` is never a target.
export const sessionReportDecisionSchema = z.enum(['reviewed', 'dismissed'])
export type SessionReportDecision = z.infer<typeof sessionReportDecisionSchema>

export const listSessionReportsInputSchema = z.object({
  status: sessionReportStatusSchema.default('open'),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
})
export type ListSessionReportsInput = z.infer<typeof listSessionReportsInputSchema>

export const reviewSessionReportInputSchema = z.object({
  reportId: z.string().uuid(),
  status: sessionReportDecisionSchema,
  // The reviewer's reasoning — the record of why, not optional.
  note: z.string().trim().min(1).max(2000),
})
export type ReviewSessionReportInput = z.infer<typeof reviewSessionReportInputSchema>

// The moderator's read of a reported circle's conversation (the Review
// dialog in /manage). Windowed around the moment the report was filed:
// `around` is the first fetch (a page before and a page after that
// moment), `before`/`after` page outward from a cursor the previous
// page returned — the same created_at|id cursor shape as
// session.listMessages, but bidirectional, since a reviewer scrolls both
// ways from the middle of a transcript rather than up from the live end.
export const sessionReportTranscriptInputSchema = z.object({
  reportId: z.string().uuid(),
  direction: z.enum(['around', 'before', 'after']).default('around'),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
})
export type SessionReportTranscriptInput = z.infer<typeof sessionReportTranscriptInputSchema>
