import type { HTMLAttributes } from 'react'
import './Heading.css'

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Which heading level to render — controls both the tag and the size. */
  level?: 1 | 2 | 3 | 4 | 5 | 6
}

export function Heading({ level = 1, className, ...props }: HeadingProps) {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  return (
    <Tag className={['ds-heading', `ds-heading--${level}`, className].filter(Boolean).join(' ')} {...props} />
  )
}
