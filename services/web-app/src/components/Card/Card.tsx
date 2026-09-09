import { type HTMLAttributes } from 'react'
import './Card.css'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean
}

export function Card({ padded = true, className, ...props }: CardProps) {
  return (
    <div
      className={['ds-card', padded && 'ds-card--padded', className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}
