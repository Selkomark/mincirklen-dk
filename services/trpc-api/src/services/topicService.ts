import type { Topic } from '@mincirklen/shared'

export interface ListTopicsDeps {
  listActiveTopics(): Promise<Topic[]>
}

export async function listTopics(deps: ListTopicsDeps): Promise<Topic[]> {
  return deps.listActiveTopics()
}
