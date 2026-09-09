import { describe, expect, test } from 'bun:test'
import { isAuthorizedToJoinRoom, publishToRoom, relayMessages } from './roomRelayService'

async function* fakeMessages(values: string[]): AsyncIterable<string> {
  for (const value of values) {
    yield value
  }
}

describe('isAuthorizedToJoinRoom', () => {
  test('delegates to the injected membership check', async () => {
    expect(await isAuthorizedToJoinRoom({ isSessionMember: async () => true })).toBe(true)
    expect(await isAuthorizedToJoinRoom({ isSessionMember: async () => false })).toBe(false)
  })
})

describe('relayMessages', () => {
  test('sends every message from the iterable, in order', async () => {
    const sent: string[] = []
    await relayMessages(fakeMessages(['a', 'b', 'c']), (data) => sent.push(data))
    expect(sent).toEqual(['a', 'b', 'c'])
  })

  test('sends nothing for an empty iterable', async () => {
    const sent: string[] = []
    await relayMessages(fakeMessages([]), (data) => sent.push(data))
    expect(sent).toEqual([])
  })
})

describe('publishToRoom', () => {
  test('delegates to the injected publish call with the given payload', () => {
    const published: unknown[] = []
    publishToRoom({ publish: (payload) => published.push(payload) }, { id: 'm1', body: 'hi' })
    expect(published).toEqual([{ id: 'm1', body: 'hi' }])
  })
})
