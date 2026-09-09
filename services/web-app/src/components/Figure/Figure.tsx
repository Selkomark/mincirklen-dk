import type { HTMLAttributes, ReactNode } from 'react'
import './Figure.css'

export interface FigureProps extends HTMLAttributes<HTMLElement> {
  caption?: ReactNode
  children: ReactNode
}

export function Figure({ caption, children, className, ...props }: FigureProps) {
  return (
    <figure className={['ds-figure', className].filter(Boolean).join(' ')} {...props}>
      {children}
      {caption && <figcaption className="ds-figure__caption">{caption}</figcaption>}
    </figure>
  )
}
