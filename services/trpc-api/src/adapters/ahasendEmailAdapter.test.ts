import * as http from 'node:http'
import { describe, expect, test } from 'bun:test'
import { AhaSendError, createAhaSendEmailSender, extractProviderMessageId } from './ahasendEmailAdapter'

// A real, ephemeral in-process HTTP server per test, standing in for
// AhaSend — same approach as websocketServiceAdapter.test.ts.
interface Received {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: unknown
}

async function withFakeServer(
  respond: (req: Received, res: http.ServerResponse) => void,
  run: (baseUrl: string, received: Received[]) => Promise<void>,
): Promise<void> {
  const received: Received[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()))
    req.on('end', () => {
      const entry = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null }
      received.push(entry)
      respond(entry, res)
    })
  })
  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve(`http://127.0.0.1:${port}`)
    })
  })
  try {
    await run(baseUrl, received)
  } finally {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const MESSAGE = { to: 'member@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' }

describe('createAhaSendEmailSender', () => {
  test('posts the message in AhaSend\'s shape with a bearer token and returns the provider id', async () => {
    await withFakeServer(
      (_req, res) => {
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: '<abc@send.ahasend.com>', recipient: { email: 'member@example.com' } }] }))
      },
      async (baseUrl, received) => {
        const sender = createAhaSendEmailSender({ apiUrl: `${baseUrl}/v2/`, accountId: 'acc 1', apiKey: 'k', from: { email: 'no-reply@x', name: 'MinCirklen' } })
        const result = await sender.sendEmail(MESSAGE)
        expect(result).toEqual({ providerMessageId: '<abc@send.ahasend.com>' })
        expect(received).toHaveLength(1)
        expect(received[0]?.method).toBe('POST')
        expect(received[0]?.url).toBe('/v2/accounts/acc%201/messages')
        expect(received[0]?.headers.authorization).toBe('Bearer k')
        expect(received[0]?.headers['content-type']).toBe('application/json')
        expect(received[0]?.body).toEqual({
          from: { email: 'no-reply@x', name: 'MinCirklen' },
          recipients: [{ email: 'member@example.com' }],
          subject: 'Hello',
          html_content: '<p>Hi</p>',
          text_content: 'Hi',
        })
      },
    )
  })

  test('returns a null id when the response carries none or is not JSON', async () => {
    await withFakeServer(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('ok')
      },
      async (baseUrl) => {
        const sender = createAhaSendEmailSender({ apiUrl: baseUrl, accountId: 'a', apiKey: 'k', from: { email: 'f@x' } })
        expect(await sender.sendEmail(MESSAGE)).toEqual({ providerMessageId: null })
      },
    )
  })

  test('a rejected call throws an AhaSendError carrying the status and a bounded body excerpt', async () => {
    await withFakeServer(
      (_req, res) => {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'bad key' }))
      },
      async (baseUrl) => {
        const sender = createAhaSendEmailSender({ apiUrl: baseUrl, accountId: 'a', apiKey: 'k', from: { email: 'f@x' } })
        const err = await sender.sendEmail(MESSAGE).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(AhaSendError)
        expect(err).toBeInstanceOf(Error)
        expect((err as AhaSendError).status).toBe(401)
        expect((err as AhaSendError).message).toContain('401')
        expect((err as AhaSendError).message).toContain('bad key')
        expect((err as AhaSendError).name).toBe('AhaSendError')
      },
    )
  })

  test('a connection failure throws an AhaSendError with no status', async () => {
    const sender = createAhaSendEmailSender({ apiUrl: 'http://127.0.0.1:9', accountId: 'a', apiKey: 'k', from: { email: 'f@x' } })
    const err = await sender.sendEmail(MESSAGE).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AhaSendError)
    expect((err as AhaSendError).status).toBeNull()
    expect((err as AhaSendError).message).toContain('request failed')
  })

  test('a stalled provider times out', async () => {
    await withFakeServer(
      () => {
        /* never respond */
      },
      async (baseUrl) => {
        const sender = createAhaSendEmailSender({ apiUrl: baseUrl, accountId: 'a', apiKey: 'k', from: { email: 'f@x' }, timeoutMs: 50 })
        const err = await sender.sendEmail(MESSAGE).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(AhaSendError)
        expect((err as AhaSendError).status).toBeNull()
      },
    )
  })

  test('uses an injected fetch when given one', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string | URL | Request) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ message_id: 'm-1' }), { status: 200 })
    }) as unknown as typeof fetch
    const sender = createAhaSendEmailSender({ apiUrl: 'https://send.example', accountId: 'a', apiKey: 'k', from: { email: 'f@x' } }, fakeFetch)
    expect(await sender.sendEmail(MESSAGE)).toEqual({ providerMessageId: 'm-1' })
    expect(calls).toEqual(['https://send.example/accounts/a/messages'])
  })
})

describe('extractProviderMessageId', () => {
  test('reads data[0].id, then id, then message_id; null otherwise', () => {
    expect(extractProviderMessageId({ data: [{ id: 'a' }], id: 'b' })).toBe('a')
    expect(extractProviderMessageId({ data: [], id: 'b' })).toBe('b')
    expect(extractProviderMessageId({ data: [{}], message_id: 'c' })).toBe('c')
    expect(extractProviderMessageId({ data: 'x' })).toBeNull()
    expect(extractProviderMessageId({ id: '' })).toBeNull()
    expect(extractProviderMessageId(null)).toBeNull()
    expect(extractProviderMessageId('str')).toBeNull()
  })
})
