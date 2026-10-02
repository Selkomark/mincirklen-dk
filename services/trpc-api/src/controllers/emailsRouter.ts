import {
  getEmailMessageInputSchema,
  listEmailMessagesInputSchema,
  listEmailSuppressionsInputSchema,
  previewEmailTemplateInputSchema,
  sendTestEmailInputSchema,
  SUPPORTED_LANGUAGES,
} from '@mincirklen/shared'
import { EmailVariablesError, getTemplate, listTemplates, renderEmail } from '@mincirklen/emails'
import { TRPCError } from '@trpc/server'
import { listEmailEventsForMessage } from '../repositories/emailEventRepository'
import { findEmailMessageById, getEmailStats, listEmailMessages, type EmailMessageSummary } from '../repositories/emailMessageRepository'
import { listEmailSuppressions } from '../repositories/emailSuppressionRepository'
import { findEmailForUser } from '../repositories/userRepository'
import { createEmailServiceDeps, sendToAddress } from '../services/emailService'
import { hasPermission, router } from './trpc'

// The /manage "Emails" section: what was sent, what the provider said
// happened to it, which addresses it won't deliver to, and the template
// catalog with a preview and a test send. Reading is emails.read;
// sending a test is its own permission because it reaches outside the
// platform. The recipient comes back masked; the full address only to
// users.read_pii holders, and only where the member's row still exists
// to decrypt it from — we never stored the address on the email row.

const STATS_WINDOW_DAYS = 30

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof EmailVariablesError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: err.message })
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: err })
}

type WithRecipient<T extends EmailMessageSummary> = T & { toEmail: string | null }

async function withUnmaskedRecipients<T extends EmailMessageSummary>(
  ctx: { appEnv: { db: Parameters<typeof findEmailForUser>[0]; vault: Parameters<typeof findEmailForUser>[1] }; permissions: string[] },
  messages: T[],
): Promise<WithRecipient<T>[]> {
  const unmask = ctx.permissions.includes('users.read_pii')
  return Promise.all(
    messages.map(async (m) => ({
      ...m,
      toEmail: unmask && m.userId ? await findEmailForUser(ctx.appEnv.db, ctx.appEnv.vault, m.userId) : null,
    })),
  )
}

export const emailsRouter = router({
  stats: hasPermission('emails.read').query(async ({ ctx }) => {
    const since = new Date(Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const counts = await getEmailStats(ctx.appEnv.db, since)
    return { windowDays: STATS_WINDOW_DAYS, ...counts }
  }),

  list: hasPermission('emails.read')
    .input(listEmailMessagesInputSchema)
    .query(async ({ ctx, input }) => {
      const page = await listEmailMessages(ctx.appEnv.db, input)
      return { messages: await withUnmaskedRecipients(ctx, page.messages), nextCursor: page.nextCursor }
    }),

  get: hasPermission('emails.read')
    .input(getEmailMessageInputSchema)
    .query(async ({ ctx, input }) => {
      const message = await findEmailMessageById(ctx.appEnv.db, input.id)
      if (!message) throw new TRPCError({ code: 'NOT_FOUND', message: 'email not found' })
      const [withRecipient] = await withUnmaskedRecipients(ctx, [message])
      const events = await listEmailEventsForMessage(ctx.appEnv.db, input.id)
      return { message: withRecipient, events }
    }),

  suppressions: router({
    list: hasPermission('emails.read')
      .input(listEmailSuppressionsInputSchema)
      .query(({ ctx, input }) => listEmailSuppressions(ctx.appEnv.db, input)),
  }),

  templates: router({
    list: hasPermission('emails.read').query(() => ({
      templates: listTemplates(),
      languages: [...SUPPORTED_LANGUAGES],
    })),

    // Pure: the same renderEmail the send path uses, so what the admin
    // sees is what a member would get.
    preview: hasPermission('emails.read')
      .input(previewEmailTemplateInputSchema)
      .query(({ input }) => {
        try {
          const variables = input.variables ?? getTemplate(input.templateKey).sampleVariables
          return renderEmail(input.templateKey, input.language, variables)
        } catch (err) {
          throw toTRPCError(err)
        }
      }),
  }),

  sendTest: hasPermission('emails.send_test')
    .input(sendTestEmailInputSchema)
    .mutation(async ({ ctx, input }) => {
      const variables = input.variables ?? getTemplate(input.templateKey).sampleVariables
      // Validate up front so a bad test request is a 400, not a row
      // marked failed.
      try {
        renderEmail(input.templateKey, input.language, variables)
      } catch (err) {
        throw toTRPCError(err)
      }
      return sendToAddress(createEmailServiceDeps(ctx.appEnv), {
        to: input.to,
        templateKey: input.templateKey,
        variables: variables as never,
        language: input.language,
        userId: null,
        isTest: true,
      })
    }),
})
