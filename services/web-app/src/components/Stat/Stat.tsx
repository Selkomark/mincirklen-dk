import type { HTMLAttributes, ReactNode } from 'react'
import './Stat.css'

export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  value: ReactNode
  label: ReactNode
}

export function Stat({ value, label, className, ...props }: StatProps) {
  return (
    <div className={['ds-stat', className].filter(Boolean).join(' ')} {...props}>
      <div className="ds-stat__value">{value}</div>
      <div className="ds-stat__label">{label}</div>
    </div>
  )
}
