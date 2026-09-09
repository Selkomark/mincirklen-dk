import type { HTMLAttributes, ReactNode } from 'react'
import './PricingCard.css'

export interface PricingCardProps extends HTMLAttributes<HTMLDivElement> {
  name: string
  price: ReactNode
  period?: string
  features: string[]
  cta: ReactNode
  highlighted?: boolean
}

export function PricingCard({
  name,
  price,
  period,
  features,
  cta,
  highlighted = false,
  className,
  ...props
}: PricingCardProps) {
  return (
    <div
      className={['ds-pricing-card', highlighted && 'ds-pricing-card--highlighted', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      <div className="ds-pricing-card__name">{name}</div>
      <div className="ds-pricing-card__price">
        {price}
        {period && <span className="ds-pricing-card__period">/{period}</span>}
      </div>
      <ul className="ds-pricing-card__features">
        {features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <div className="ds-pricing-card__cta">{cta}</div>
    </div>
  )
}
