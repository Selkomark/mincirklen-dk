// One-off dev script — not part of the coverage-checked source tree, not
// shipped code. Injects realistic test data into a session's message
// history so scroll-up-for-older-messages pagination (SessionPage.tsx)
// can be exercised against something bigger than a handful of manually
// typed messages.
//
// Usage: bun run packages/shared/scripts/seedSessionMessages.ts <sessionId> [count]
//
// Inserts directly via db.insertInto('messages') rather than
// messageRepository.insertMessage — that function always defaults
// created_at to now(), and this needs realistic backdating spread across
// a multi-day window so the seeded history reads like a real conversation
// rather than 300 messages all timestamped within the same second.
import { createDb, createPgPool, DEFAULT_LOCAL_DATABASE_URL } from '../src'

const SHORT_BODIES = [
  'hey',
  'thanks for sharing that',
  'that makes a lot of sense',
  'im here, just listening',
  'same here honestly',
  'appreciate you saying that',
  'ok',
  'yeah i get that',
  'thank you',
  'thats really helpful',
  'i needed to hear that today',
  'sending support',
  'good point',
  'agreed',
  'im glad you brought this up',
  'take your time',
  'no rush at all',
  'that resonates with me',
  'im proud of you for sharing',
  'lets keep going',
]

const LONG_SENTENCES = [
  'I think what really helped me this week was just naming the feeling instead of trying to push through it right away.',
  'It took me a long time to realize that asking for help wasnt a sign of weakness, it was actually the harder and braver thing to do.',
  'Something that stuck with me from last time was the idea that progress isnt linear, and some days are just going to be harder than others.',
  'I want to thank everyone here for creating a space where I can actually say these things out loud without feeling judged.',
  'When I sat with the discomfort instead of avoiding it, I noticed it passed a lot faster than I expected it to.',
  'My therapist mentioned something similar last week, and hearing it again from this group made it click in a different way.',
  'I still struggle with this most days, but having somewhere to talk about it openly has made a real difference for me.',
  'Its strange how something so small can feel like such a big step forward, but I guess thats how it works sometimes.',
  'I noticed a pattern this week where I kept avoiding the conversation entirely, and naming that out loud already feels like progress.',
  'Reading everyone elses experiences here has honestly made me feel a lot less alone in what Ive been going through lately.',
]

function randomShortBody(): string {
  return SHORT_BODIES[Math.floor(Math.random() * SHORT_BODIES.length)] as string
}

function composeLongBody(): string {
  const sentenceCount = 2 + Math.floor(Math.random() * 2)
  const sentences: string[] = []
  for (let i = 0; i < sentenceCount; i++) {
    sentences.push(LONG_SENTENCES[Math.floor(Math.random() * LONG_SENTENCES.length)] as string)
  }
  return sentences.join(' ')
}

async function main() {
  const [sessionId, countArg] = process.argv.slice(2)
  if (!sessionId) {
    throw new Error('usage: bun run packages/shared/scripts/seedSessionMessages.ts <sessionId> [count]')
  }
  const count = countArg ? Number(countArg) : 300
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(`invalid count: ${countArg}`)
  }

  const pool = createPgPool(process.env.DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, process.env.DB_SCHEMA ?? 'dev')
  const db = createDb(pool)

  try {
    const members = await db.selectFrom('session_users').select('user_id').where('session_id', '=', sessionId).execute()
    if (members.length === 0) {
      throw new Error(`session ${sessionId} has no members — add real members first, this script never fabricates fake ones`)
    }

    const now = Date.now()
    const spanMs = 1000 * 60 * 60 * 24 * 3 // spread across a realistic 3-day window, oldest first
    const rows = Array.from({ length: count }, (_, i) => {
      const member = members[i % members.length] as { user_id: string }
      const isLong = Math.random() < 0.35
      const body = isLong ? composeLongBody() : randomShortBody()
      const createdAt = new Date(now - spanMs + Math.floor((i / count) * spanMs))
      return { session_id: sessionId, user_id: member.user_id, body, created_at: createdAt }
    })

    const BATCH_SIZE = 50
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await db.insertInto('messages').values(rows.slice(i, i + BATCH_SIZE)).execute()
    }

    console.log(`inserted ${rows.length} messages into session ${sessionId} across ${members.length} member(s)`)
  } finally {
    await db.destroy()
  }
}

if (import.meta.main) await main()
