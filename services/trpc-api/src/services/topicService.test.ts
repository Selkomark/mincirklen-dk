import { describe, expect, test } from 'bun:test'
import { listTopics } from './topicService'

describe('listTopics', () => {
  test('delegates to the injected dependency', async () => {
    const topics = [{ id: 't1', slug: 'grief', label: 'Grief' }]
    const result = await listTopics({ listActiveTopics: async () => topics })
    expect(result).toEqual(topics)
  })
})
