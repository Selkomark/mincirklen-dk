import { authRouter } from './authRouter'
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
})

export type AppRouter = typeof appRouter
