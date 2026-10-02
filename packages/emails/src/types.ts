import type { ReactElement } from 'react'
import type { z } from 'zod'
import type { EmailLanguage, EmailTemplateKey } from '@mincirklen/shared'

export type { EmailLanguage, EmailTemplateKey }

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

// Per-template copy. English is the complete set; the other languages
// may cover any subset and fall back to English key by key (i18n.ts).
// Values may carry `{{name}}` placeholders filled by `fill()`.
export type TemplateStrings<S extends Record<string, string>> = {
  en: S
  da?: Partial<S>
  sv?: Partial<S>
}

// Who signs the footer. Moderation emails come from "the moderation
// team"; the rest from "the team".
export type SignOff = 'moderation' | 'team'

export interface EmailTemplateDefinition<V, S extends Record<string, string>> {
  key: EmailTemplateKey
  // One line for the admin template catalog.
  description: string
  signOff: SignOff
  variablesSchema: z.ZodType<V>
  // Fills the admin preview before anyone edits the variables.
  sampleVariables: V
  strings: TemplateStrings<S>
  subject: (variables: V, strings: S) => string
  Body: (props: { variables: V; strings: S }) => ReactElement
}

// Erased form for the registry map.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEmailTemplate = EmailTemplateDefinition<any, any>

// Identity helper so each template file gets V and S inferred from its
// schema and English strings without spelling them out twice.
export function defineTemplate<V, S extends Record<string, string>>(definition: EmailTemplateDefinition<V, S>): EmailTemplateDefinition<V, S> {
  return definition
}
