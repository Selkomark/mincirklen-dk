import type { CSSProperties, HTMLAttributes } from 'react'
import './Row.css'

export interface RowProps extends HTMLAttributes<HTMLDivElement> {
  /** Gap between columns, on our 1-8 spacing scale (--space-1 .. --space-8). */
  gap?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

export function Row({ gap = 4, className, style, ...props }: RowProps) {
  return (
    <div
      className={['ds-row', className].filter(Boolean).join(' ')}
      style={{ ...({ '--ds-row-gap': `var(--space-${gap})` } as CSSProperties), ...style }}
      {...props}
    />
  )
}
