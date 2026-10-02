import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { EmailTemplateKey } from '@mincirklen/shared'
import type { EmailLanguage, RenderedEmail } from './types'
import { resolveStrings } from './i18n'
import { htmlToText } from './htmlToText'
import { getTemplate } from './registry'
import { Layout } from './components/Layout'

// Thrown when the variables don't satisfy the template's schema — a
// programming error at a call site, or a bad preview request in admin.
export class EmailVariablesError extends Error {
  constructor(
    readonly templateKey: EmailTemplateKey,
    readonly issues: string[],
  ) {
    super(`invalid variables for email template "${templateKey}": ${issues.join('; ')}`)
    this.name = 'EmailVariablesError'
  }
}

// Subject, HTML and derived plain text for one email. Pure: no I/O, so
// the admin preview and the real send go through the same function.
export function renderEmail(templateKey: EmailTemplateKey, language: EmailLanguage, variables: unknown): RenderedEmail {
  const template = getTemplate(templateKey)
  const parsed = template.variablesSchema.safeParse(variables)
  if (!parsed.success) {
    throw new EmailVariablesError(
      templateKey,
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    )
  }
  const strings = resolveStrings(template.strings, language)
  const subject = template.subject(parsed.data, strings)
  const body = createElement(template.Body, { variables: parsed.data, strings })
  const markup = renderToStaticMarkup(createElement(Layout, { language, signOff: template.signOff, children: body }))
  const html = `<!doctype html>${markup}`
  return { subject, html, text: htmlToText(html) }
}
