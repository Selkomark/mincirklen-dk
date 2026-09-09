import type { HTMLAttributes, ReactNode } from 'react'
import { Section } from '../Section'
import './Hero.css'

export interface HeroProps extends HTMLAttributes<HTMLElement> {
  /** Optional image/illustration — renders as a split layout when present. */
  media?: ReactNode
  align?: 'center' | 'left'
  tone?: 'app' | 'raised' | 'sunken'
}

export function Hero({ media, align = 'center', tone = 'app', className, children, ...props }: HeroProps) {
  return (
    <Section
      tone={tone}
      spacing="xl"
      className={['ds-hero', media && 'ds-hero--split', className].filter(Boolean).join(' ')}
      {...props}
    >
      <div className={['ds-hero__content', `ds-hero__content--${align}`].join(' ')}>{children}</div>
      {media && <div className="ds-hero__media">{media}</div>}
    </Section>
  )
}
