import { afterEach, describe, expect, test } from 'bun:test'
import { KmsError, decryptField, encryptField } from './kmsAdapter'

const originalFetch = globalThis.fetch
const CONFIG = { provider: 'vault' as const, vaultAddr: 'http://vault.invalid', vaultToken: 'test-token' }
const GCP_CONFIG = { provider: 'gcp' as const, keyName: 'projects/p/locations/l/keyRings/r/cryptoKeys/k' }

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('KmsError', () => {
  test('is a real Error subclass', () => {
    const err = new KmsError('boom')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('boom')
  })
})

describe('encryptField', () => {
  test('base64-encodes the plaintext and returns the ciphertext', async () => {
    let capturedBody: unknown
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return Response.json({ data: { ciphertext: 'vault:v1:abc' } })
    }) as unknown as typeof fetch

    await expect(encryptField(CONFIG, 'hello')).resolves.toBe('vault:v1:abc')
    expect(capturedBody).toEqual({ plaintext: Buffer.from('hello', 'utf8').toString('base64') })
  })

  test('throws when the response is not ok', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch
    await expect(encryptField(CONFIG, 'hello')).rejects.toThrow('status 503')
  })

  test('throws when the response has no data', async () => {
    globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch
    await expect(encryptField(CONFIG, 'hello')).rejects.toThrow('missing "data"')
  })

  test('throws when the response is missing ciphertext', async () => {
    globalThis.fetch = (async () => Response.json({ data: {} })) as unknown as typeof fetch
    await expect(encryptField(CONFIG, 'hello')).rejects.toThrow('missing ciphertext')
  })
})

describe('decryptField', () => {
  test('base64-decodes the returned plaintext', async () => {
    let capturedBody: unknown
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return Response.json({ data: { plaintext: Buffer.from('hello', 'utf8').toString('base64') } })
    }) as unknown as typeof fetch

    await expect(decryptField(CONFIG, 'vault:v1:abc')).resolves.toBe('hello')
    expect(capturedBody).toEqual({ ciphertext: 'vault:v1:abc' })
  })

  test('throws when the response is not ok', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 400 })) as unknown as typeof fetch
    await expect(decryptField(CONFIG, 'vault:v1:abc')).rejects.toThrow('status 400')
  })

  test('throws when the response is missing plaintext', async () => {
    globalThis.fetch = (async () => Response.json({ data: {} })) as unknown as typeof fetch
    await expect(decryptField(CONFIG, 'vault:v1:abc')).rejects.toThrow('missing plaintext')
  })
})

// Ordered deliberately: the metadata-token-fetch-failure cases run first,
// while the module-level token cache is still cold, then the
// success/caching cases warm it, then the KMS-response-failure cases rely
// on that warm cache so their mocks only need to handle one URL. See
// kmsAdapter.ts's gcpAccessToken for the cache this depends on.
describe('encryptField/decryptField (GCP Cloud KMS)', () => {
  test('throws when the metadata server token request is not ok', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch
    await expect(encryptField(GCP_CONFIG, 'hello')).rejects.toThrow('metadata token request failed')
  })

  test('throws when the metadata server response is missing access_token/expires_in', async () => {
    globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch
    await expect(encryptField(GCP_CONFIG, 'hello')).rejects.toThrow('missing access_token/expires_in')
  })

  test('fetches a metadata token, then encrypts via Cloud KMS', async () => {
    const calledUrls: string[] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calledUrls.push(url)
      if (url.includes('metadata.google.internal')) {
        expect(init.headers).toMatchObject({ 'Metadata-Flavor': 'Google' })
        return Response.json({ access_token: 'gcp-token', expires_in: 3600 })
      }
      expect(url).toBe(`https://cloudkms.googleapis.com/v1/${GCP_CONFIG.keyName}:encrypt`)
      expect(init.headers).toMatchObject({ authorization: 'Bearer gcp-token' })
      return Response.json({ ciphertext: 'gcp-ciphertext' })
    }) as unknown as typeof fetch

    await expect(encryptField(GCP_CONFIG, 'hello')).resolves.toBe('gcp-ciphertext')
    expect(calledUrls).toHaveLength(2)
  })

  test('reuses the cached token on a later call instead of refetching it', async () => {
    let calls = 0
    globalThis.fetch = (async (url: string) => {
      calls += 1
      expect(url).toBe(`https://cloudkms.googleapis.com/v1/${GCP_CONFIG.keyName}:decrypt`)
      return Response.json({ plaintext: Buffer.from('hello', 'utf8').toString('base64') })
    }) as unknown as typeof fetch

    await expect(decryptField(GCP_CONFIG, 'gcp-ciphertext')).resolves.toBe('hello')
    expect(calls).toBe(1)
  })

  test('throws when the Cloud KMS response is not ok', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 400 })) as unknown as typeof fetch
    await expect(encryptField(GCP_CONFIG, 'hello')).rejects.toThrow('encrypt request failed')
  })

  test('throws when the Cloud KMS encrypt response is missing ciphertext', async () => {
    globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch
    await expect(encryptField(GCP_CONFIG, 'hello')).rejects.toThrow('missing ciphertext')
  })

  test('throws when the Cloud KMS decrypt response is missing plaintext', async () => {
    globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch
    await expect(decryptField(GCP_CONFIG, 'gcp-ciphertext')).rejects.toThrow('missing plaintext')
  })
})
