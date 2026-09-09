import { describe, expect, test } from 'bun:test'
import { deleteAccount } from './accountDeletionService'

describe('deleteAccount', () => {
  test('delegates to deleteUser', async () => {
    let called = false

    await deleteAccount({
      deleteUser: async () => {
        called = true
      },
    })

    expect(called).toBe(true)
  })
})
