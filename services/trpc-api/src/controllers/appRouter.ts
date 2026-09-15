import { authRouter } from './authRouter'
import { gatesRouter } from './gatesRouter'
import { moderationRouter } from './moderationRouter'
import { rbacRouter } from './rbacRouter'
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
})

export type AppRouter = typeof appRouter
