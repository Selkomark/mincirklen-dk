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
})
export type ReviewSessionReportInput = z.infer<typeof reviewSessionReportInputSchema>
