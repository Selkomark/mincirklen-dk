import type { Database, Topic } from '@mincirklen/shared'
import type { Kysely } from 'kysely'

export async function listActiveTopics(db: Kysely<Database>): Promise<Topic[]> {
  const rows = await db
    .selectFrom('topics')
    .select(['id', 'slug', 'label'])
    .where('is_active', '=', true)
    .orderBy('sort_order', 'asc')
    .execute()

  return rows
}
