import type { ElementType, HTMLAttributes } from 'react'
import './Text.css'

export type TextVariant = 'body' | 'lead' | 'muted' | 'small'

export interface TextProps extends HTMLAttributes<HTMLElement> {
  variant?: TextVariant
  /** Element to render — defaults to 'p'. */
  as?: ElementType
}

export function Text({ variant = 'body', as: Tag = 'p', className, ...props }: TextProps) {
  return (
    <Tag className={['ds-text', `ds-text--${variant}`, className].filter(Boolean).join(' ')} {...props} />
  )
}
