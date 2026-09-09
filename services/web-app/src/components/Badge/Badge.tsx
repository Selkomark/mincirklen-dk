import { type HTMLAttributes } from 'react'
import './Badge.css'

export type BadgeVariant = 'neutral' | 'safe' | 'info' | 'urgent'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export function Badge({ variant = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={['ds-badge', `ds-badge--${variant}`, className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}
