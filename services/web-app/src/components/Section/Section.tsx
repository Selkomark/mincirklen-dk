import type { HTMLAttributes } from 'react'
import { Container } from '../Container'
import './Section.css'

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  /** Background surface for the whole section. */
  tone?: 'app' | 'raised' | 'sunken'
  /** Vertical padding scale. */
  spacing?: 'md' | 'lg' | 'xl'
  /** Wraps children in a centered Container. Set false to control width yourself. */
  container?: boolean
}

export function Section({
  tone = 'app',
  spacing = 'lg',
  container = true,
  className,
  children,
  ...props
}: SectionProps) {
  return (
    <section
      className={['ds-section', `ds-section--${tone}`, `ds-section--${spacing}`, className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {container ? <Container>{children}</Container> : children}
    </section>
  )
}
