import { type HTMLAttributes } from 'react'
import './Skeleton.css'

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: number | string
  height?: number | string
  radius?: string
}

// A single pulsing block. Compose these into shapes that mirror the
// eventual content's real layout (a topic-chip row, a circle-list row —
// see pages/start/shared.tsx) rather than a generic spinner/"Loading…"
// text, per the skeleton-loading skill.
export function Skeleton({ width = '100%', height = 16, radius = 'var(--radius-sm)', style, className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={['ds-skeleton', className].filter(Boolean).join(' ')}
      style={{ width, height, borderRadius: radius, ...style }}
      {...props}
    />
  )
}
