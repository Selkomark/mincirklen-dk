import { type HTMLAttributes } from 'react'
import './Spinner.css'

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: number
}

// Uses currentColor so it inherits whatever text color it's placed in —
// e.g. Button renders it inline with the label, no color prop needed.
export function Spinner({ size = 16, className, ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={['ds-spinner', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      {...props}
    >
      <svg viewBox="0 0 24 24" fill="none" width="100%" height="100%">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  )
}
