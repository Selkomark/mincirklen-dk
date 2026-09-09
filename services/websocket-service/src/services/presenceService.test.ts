import { describe, expect, test } from 'bun:test'
import { joinPresence, leavePresence, type PresenceServiceDeps } from './presenceService'

function fakeDeps(overrides: Partial<PresenceServiceDeps> = {}): PresenceServiceDeps & {
  publishedCounts: { sessionId: string; count: number }[]
  publishedUsers: { sessionId: string; userIds: string[] }[]
  clearedSessions: string[]
} {
  const publishedCounts: { sessionId: string; count: number }[] = []
  const publishedUsers: { sessionId: string; userIds: string[] }[] = []
  const clearedSessions: string[] = []
  return {
    markOnline: async () => {},
    markOffline: async () => {},
    getOnlineUserIds: async () => [],
    publishLiveCount: (sessionId, count) => publishedCounts.push({ sessionId, count }),
    publishOnlineUsers: (sessionId, userIds) => publishedUsers.push({ sessionId, userIds }),
    clearTurnState: async (sessionId) => {
      clearedSessions.push(sessionId)
    },
    publishedCounts,
    publishedUsers,
    clearedSessions,
    ...overrides,
  }
}

describe('joinPresence', () => {
  test('marks the user online, then publishes the resulting count and user list', async () => {
    const marked: { sessionId: string; userId: string }[] = []
    const deps = fakeDeps({
      markOnline: async (sessionId, userId) => {
        marked.push({ sessionId, userId })
      },
      getOnlineUserIds: async () => ['user-1', 'user-2', 'user-3'],
    })

    await joinPresence(deps, 'session-1', 'user-1')

    expect(marked).toEqual([{ sessionId: 'session-1', userId: 'user-1' }])
    expect(deps.publishedCounts).toEqual([{ sessionId: 'session-1', count: 3 }])
    expect(deps.publishedUsers).toEqual([{ sessionId: 'session-1', userIds: ['user-1', 'user-2', 'user-3'] }])
    expect(deps.clearedSessions).toEqual([])
  })
})

describe('leavePresence', () => {
  test('marks the user offline, then publishes the resulting count and user list', async () => {
    const marked: { sessionId: string; userId: string }[] = []
    const deps = fakeDeps({
      markOffline: async (sessionId, userId) => {
        marked.push({ sessionId, userId })
      },
      getOnlineUserIds: async () => ['user-2'],
    })

    await leavePresence(deps, 'session-1', 'user-1')

    expect(marked).toEqual([{ sessionId: 'session-1', userId: 'user-1' }])
    expect(deps.publishedCounts).toEqual([{ sessionId: 'session-1', count: 1 }])
    expect(deps.publishedUsers).toEqual([{ sessionId: 'session-1', userIds: ['user-2'] }])
  })

  test('clears the turn/roster cache once nobody is left online', async () => {
    const deps = fakeDeps({ getOnlineUserIds: async () => [] })

    await leavePresence(deps, 'session-1', 'user-1')

    expect(deps.clearedSessions).toEqual(['session-1'])
  })

  test('does not clear anything while other members are still online', async () => {
    const deps = fakeDeps({ getOnlineUserIds: async () => ['user-2'] })

    await leavePresence(deps, 'session-1', 'user-1')

    expect(deps.clearedSessions).toEqual([])
  })
})
