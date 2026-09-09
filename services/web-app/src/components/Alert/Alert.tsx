import { type HTMLAttributes, type ReactNode } from 'react'
import './Alert.css'

export type AlertVariant = 'info' | 'safe' | 'urgent'

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant
  icon?: ReactNode
}

export function Alert({ variant = 'info', icon, children, className, ...props }: AlertProps) {
  return (
    <div
      role={variant === 'urgent' ? 'alert' : 'status'}
      className={['ds-alert', `ds-alert--${variant}`, className].filter(Boolean).join(' ')}
      {...props}
    >
      {icon && <span className="ds-alert__icon">{icon}</span>}
      <div className="ds-alert__content">{children}</div>
    </div>
  )
}
