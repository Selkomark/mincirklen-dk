import { listActiveTopics } from '../repositories/topicRepository'
import * as topicService from '../services/topicService'
import { router, verifiedProcedure } from './trpc'

export const topicRouter = router({
  list: verifiedProcedure.query(async ({ ctx }) => {
    return topicService.listTopics({ listActiveTopics: () => listActiveTopics(ctx.appEnv.db) })
  }),
})
