import { describe, expect, test } from 'bun:test'
import type { NatsConnection } from 'nats'
import { publishMessage, publishPresenceEvent, subscribeToPresence, subscribeToRoom } from './natsAdapter'

describe('subscribeToRoom', () => {
  test('subscribes to the room subject, yields message strings, and unsubscribes on request', async () => {
    let unsubscribed = false
    const fakeMessages = [{ string: () => 'one' }, { string: () => 'two' }]

    const fakeSub = {
      [Symbol.asyncIterator]: async function* () {
        for (const msg of fakeMessages) yield msg
      },
      unsubscribe: () => {
        unsubscribed = true
      },
    }

    let requestedSubject: string | undefined
    const fakeNc = {
      subscribe: (subject: string) => {
        requestedSubject = subject
        return fakeSub
      },
    } as unknown as NatsConnection

    const { messages, unsubscribe } = subscribeToRoom(fakeNc, 's1')

    expect(requestedSubject).toBe('room.s1.messages')

    const received: string[] = []
    for await (const message of messages) {
      received.push(message)
    }
    expect(received).toEqual(['one', 'two'])

    unsubscribe()
    expect(unsubscribed).toBe(true)
  })
})

describe('publishMessage', () => {
  test('publishes the JSON-stringified payload to the room subject', () => {
    let publishedSubject: string | undefined
    let publishedData: string | undefined
    const fakeNc = {
      publish: (subject: string, data: string) => {
        publishedSubject = subject
        publishedData = data
      },
    } as unknown as NatsConnection

    publishMessage(fakeNc, 's1', { id: 'm1', body: 'hi' })

    expect(publishedSubject).toBe('room.s1.messages')
    expect(publishedData).toBe(JSON.stringify({ id: 'm1', body: 'hi' }))
  })
})

describe('subscribeToPresence', () => {
  test('subscribes to the presence subject, yields message strings, and unsubscribes on request', async () => {
    let unsubscribed = false
    const fakeMessages = [{ string: () => 'one' }, { string: () => 'two' }]

    const fakeSub = {
      [Symbol.asyncIterator]: async function* () {
        for (const msg of fakeMessages) yield msg
      },
      unsubscribe: () => {
        unsubscribed = true
      },
    }

    let requestedSubject: string | undefined
    const fakeNc = {
      subscribe: (subject: string) => {
        requestedSubject = subject
        return fakeSub
      },
    } as unknown as NatsConnection

    const { messages, unsubscribe } = subscribeToPresence(fakeNc, 's1')

    expect(requestedSubject).toBe('room.s1.presence')

    const received: string[] = []
    for await (const message of messages) {
      received.push(message)
    }
    expect(received).toEqual(['one', 'two'])

    unsubscribe()
    expect(unsubscribed).toBe(true)
  })
})

describe('publishPresenceEvent', () => {
  test('publishes the JSON-stringified payload to the presence subject, distinct from the room subject', () => {
    let publishedSubject: string | undefined
    let publishedData: string | undefined
    const fakeNc = {
      publish: (subject: string, data: string) => {
        publishedSubject = subject
        publishedData = data
      },
    } as unknown as NatsConnection

    publishPresenceEvent(fakeNc, 's1', { type: 'participant-joined', sessionId: 's1', userId: 'u1' })

    expect(publishedSubject).toBe('room.s1.presence')
    expect(publishedData).toBe(JSON.stringify({ type: 'participant-joined', sessionId: 's1', userId: 'u1' }))
  })
})
