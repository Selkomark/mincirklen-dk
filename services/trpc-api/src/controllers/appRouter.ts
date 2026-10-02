import { authRouter } from './authRouter'
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
})

export type AppRouter = typeof appRouter
