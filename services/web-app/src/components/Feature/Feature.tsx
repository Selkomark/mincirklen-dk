import type { HTMLAttributes, ReactNode } from 'react'
import './Feature.css'

export interface FeatureProps extends HTMLAttributes<HTMLDivElement> {
  icon: ReactNode
  title: string
  children: ReactNode
}

export function Feature({ icon, title, children, className, ...props }: FeatureProps) {
  return (
    <div className={['ds-feature', className].filter(Boolean).join(' ')} {...props}>
      <div className="ds-feature__icon">{icon}</div>
      <div className="ds-feature__title">{title}</div>
      <div className="ds-feature__body">{children}</div>
    </div>
  )
}
