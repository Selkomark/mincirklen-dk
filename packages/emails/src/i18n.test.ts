import { describe, expect, test } from 'bun:test'
import { fill, resolveStrings } from './i18n'

const strings = { en: { a: 'A', b: 'B' }, da: { a: 'Æ', b: undefined }, sv: undefined }

describe('resolveStrings', () => {
  test('returns English as-is', () => {
    expect(resolveStrings(strings, 'en')).toEqual({ a: 'A', b: 'B' })
  })
  test('overlays a partial translation key by key, ignoring undefined entries', () => {
    expect(resolveStrings(strings, 'da')).toEqual({ a: 'Æ', b: 'B' })
  })
  test('falls back to English entirely when the language has no table', () => {
    expect(resolveStrings(strings, 'sv')).toEqual({ a: 'A', b: 'B' })
  })
})

describe('fill', () => {
  test('substitutes known placeholders and leaves unknown ones visible', () => {
    expect(fill('Hi {{ name }}, {{count}} new, {{missing}}', { name: 'Ann', count: 2 })).toBe('Hi Ann, 2 new, {{missing}}')
  })
})
