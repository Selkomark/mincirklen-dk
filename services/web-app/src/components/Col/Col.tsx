import type { CSSProperties, HTMLAttributes } from 'react'
import './Col.css'

export interface ColProps extends HTMLAttributes<HTMLDivElement> {
  /** Column span out of 12, applied from the base viewport up. Omit for an equal-width flex column. */
  span?: number
  /** Column span from the md breakpoint (768px) up. */
  md?: number
  /** Column span from the lg breakpoint (1024px) up. */
  lg?: number
}

export function Col({ span, md, lg, className, style, ...props }: ColProps) {
  const sized = span != null || md != null || lg != null
  const varStyle: CSSProperties = {}
  if (span != null) (varStyle as Record<string, string>)['--col-span'] = String(span)
  if (md != null) (varStyle as Record<string, string>)['--col-span-md'] = String(md)
  if (lg != null) (varStyle as Record<string, string>)['--col-span-lg'] = String(lg)

  return (
    <div
      className={['ds-col', sized ? 'ds-col--sized' : 'ds-col--auto', className].filter(Boolean).join(' ')}
      style={{ ...varStyle, ...style }}
      {...props}
    />
  )
}
