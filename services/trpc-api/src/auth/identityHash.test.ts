import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { hashIdentitySubject } from './identityHash'

describe('hashIdentitySubject', () => {
  test('is deterministic for the same subject and key', () => {
    expect(hashIdentitySubject('subject-1', 'key-a')).toBe(hashIdentitySubject('subject-1', 'key-a'))
  })

  test('differs for different keys given the same subject', () => {
    // The whole point: reproducing a specific hash requires the key, not
    // just knowledge of the (public) algorithm and the raw subject.
    expect(hashIdentitySubject('subject-1', 'key-a')).not.toBe(hashIdentitySubject('subject-1', 'key-b'))
  })

  test('differs for different subjects given the same key', () => {
    expect(hashIdentitySubject('subject-1', 'key-a')).not.toBe(hashIdentitySubject('subject-2', 'key-a'))
  })

  test('is not a plain unkeyed SHA-256 of the subject', () => {
    const plainSha256 = createHash('sha256').update('subject-1').digest('hex')
    expect(hashIdentitySubject('subject-1', 'key-a')).not.toBe(plainSha256)
  })
})
