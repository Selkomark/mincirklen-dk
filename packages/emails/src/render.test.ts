import { describe, expect, test } from 'bun:test'
import { EMAIL_TEMPLATE_KEYS, SUPPORTED_LANGUAGES } from '@mincirklen/shared'
import { EMAIL_TEMPLATES, getTemplate, listTemplates } from './registry'
import { EmailVariablesError, renderEmail } from './render'

describe('renderEmail', () => {
  test('every template renders in every language from its sample variables', () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      for (const language of SUPPORTED_LANGUAGES) {
        const out = renderEmail(key, language, EMAIL_TEMPLATES[key].sampleVariables)
        expect(out.subject.length).toBeGreaterThan(0)
        expect(out.html).toStartWith('<!doctype html><html lang="' + language + '"')
        expect(out.html).toContain('MinCirklen')
        expect(out.text).toStartWith('MinCirklen')
        expect(out.text).toEndWith("You don't need to reply.")
        expect(out.html).not.toContain('{{')
        expect(out.text).not.toContain('{{')
      }
    }
  })

  test('moderation templates are signed by the moderation team, the gate invite by the team', () => {
    expect(renderEmail('member_warned', 'en', { message: 'x' }).text).toContain('MinCirklen moderation team')
    expect(renderEmail('gate_invite', 'en', EMAIL_TEMPLATES.gate_invite.sampleVariables).text).toContain('by the MinCirklen team.')
  })

  test('rejects variables that do not satisfy the template schema', () => {
    expect(() => renderEmail('member_warned', 'en', { message: '' })).toThrow(EmailVariablesError)
    try {
      renderEmail('gate_invite', 'en', { gateName: 'x' })
    } catch (err) {
      expect(err).toBeInstanceOf(EmailVariablesError)
      const e = err as EmailVariablesError
      expect(e.templateKey).toBe('gate_invite')
      expect(e.issues.join(' ')).toContain('inviteUrl')
      expect(e.message).toContain('gate_invite')
    }
    expect(() => renderEmail('report_received', 'en', null)).toThrow(/\(root\)/)
  })

  test('escapes HTML in variables so a moderator cannot inject markup', () => {
    const out = renderEmail('member_warned', 'en', { message: '<b>bold</b> & "quotes"' })
    expect(out.html).not.toContain('<b>bold</b>')
    expect(out.html).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(out.text).toContain('<b>bold</b> & "quotes"')
  })
})

describe('registry', () => {
  test('lists every shared key in order with a description and sample variables', () => {
    const summaries = listTemplates()
    expect(summaries.map((s) => s.key)).toEqual([...EMAIL_TEMPLATE_KEYS])
    for (const s of summaries) {
      expect(s.description.length).toBeGreaterThan(0)
      expect(typeof s.sampleVariables).toBe('object')
    }
    expect(getTemplate('gate_invite').key).toBe('gate_invite')
  })
})
