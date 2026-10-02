import { describe, expect, test } from 'bun:test'
import { createLoggingEmailSender } from './emailAdapter'

describe('createLoggingEmailSender', () => {
  test('logs a masked recipient, the subject and the text body — never the full address or the html', async () => {
    const lines: string[] = []
    const sender = createLoggingEmailSender((line) => lines.push(line))
    const result = await sender.sendEmail({
      to: 'someone@example.com',
      subject: 'A note from the moderators',
      text: 'Please keep it kind.\nSecond line.',
      html: '<p>Please keep it kind.</p>',
    })
    expect(result).toEqual({ providerMessageId: null })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('s***@example.com')
    expect(lines[0]).not.toContain('someone@')
    expect(lines[0]).toContain('subject: A note from the moderators')
    expect(lines[0]).toContain('  | Please keep it kind.')
    expect(lines[0]).toContain('  | Second line.')
    expect(lines[0]).not.toContain('<p>')
    expect(lines[0]).toContain('not delivered')
  })

  test('tolerates a malformed address', async () => {
    const lines: string[] = []
    await createLoggingEmailSender((line) => lines.push(line)).sendEmail({ to: 'nonsense', subject: 's', text: 't', html: 'h' })
    expect(lines[0]).toContain('to=***')
  })

  test('defaults to console.log', async () => {
    const original = console.log
    const lines: string[] = []
    console.log = (line: string) => void lines.push(line)
    try {
      await createLoggingEmailSender().sendEmail({ to: 'a@b.c', subject: 's', text: 't', html: 'h' })
    } finally {
      console.log = original
    }
    expect(lines).toHaveLength(1)
  })
})
