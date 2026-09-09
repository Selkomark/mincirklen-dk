import type { HTMLAttributes } from 'react'
import './Container.css'

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes the max-width, spanning the full viewport width. */
  fluid?: boolean
}

export function Container({ fluid = false, className, ...props }: ContainerProps) {
  return (
    <div
      className={['ds-container', fluid && 'ds-container--fluid', className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}
