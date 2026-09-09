import type { ReactNode } from 'react'
import { Section, type SectionProps } from '../Section'
import './CTASection.css'

export interface CTASectionProps extends Omit<SectionProps, 'tone' | 'children' | 'title'> {
  title: ReactNode
  children?: ReactNode
  actions: ReactNode
}

export function CTASection({ title, children, actions, className, ...props }: CTASectionProps) {
  return (
    <Section
      tone="raised"
      className={['ds-cta-section', className].filter(Boolean).join(' ')}
      {...props}
    >
      <div className="ds-cta-section__content">
        <div className="ds-cta-section__title">{title}</div>
        {children && <div className="ds-cta-section__body">{children}</div>}
        <div className="ds-cta-section__actions">{actions}</div>
      </div>
    </Section>
  )
}
