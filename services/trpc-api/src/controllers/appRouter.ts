import { authRouter } from './authRouter'
import { emailsRouter } from './emailsRouter'
import { gatesRouter } from './gatesRouter'
import { moderationRouter } from './moderationRouter'
import { rbacRouter } from './rbacRouter'
import { sessionReportsRouter } from './sessionReportsRouter'
import { sessionRouter } from './sessionRouter'
import { topicRouter } from './topicRouter'
import { router } from './trpc'

export const appRouter = router({
  auth: authRouter,
  session: sessionRouter,
  topics: topicRouter,
  moderation: moderationRouter,
  rbac: rbacRouter,
  gates: gatesRouter,
  sessionReports: sessionReportsRouter,
  emails: emailsRouter,
})

export type AppRouter = typeof appRouter
