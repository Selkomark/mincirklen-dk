import type { Context as HonoContext } from 'hono'
import { checkModerationServiceHealth } from '../adapters/moderationServiceAdapter'
import { checkWebsocketServiceHealth } from '../adapters/websocketServiceAdapter'
import { pingDatabase } from '../repositories/healthRepository'
import { getHealth } from '../services/healthService'
import type { AppEnv } from '../context'

export function createHealthHandler(env: AppEnv) {
  return async function healthHandler(c: HonoContext): Promise<Response> {
    const result = await getHealth({
      pingDatabase: () => pingDatabase(env.db),
      checkWebsocketService: () => checkWebsocketServiceHealth(env.websocketServiceUrl),
      checkModerationService: () => checkModerationServiceHealth(env.moderationServiceUrl),
    })

    return c.json(result)
  }
}
