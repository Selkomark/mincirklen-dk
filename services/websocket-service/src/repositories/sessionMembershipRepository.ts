// The actual query lives in @mincirklen/shared (used by trpc-api too) —
// re-exported here so this service's Controller/Service layers import from
// `repositories/`, keeping the DB-access boundary consistent regardless of
// where the query is physically implemented.
export { isSessionMember } from '@mincirklen/shared'
