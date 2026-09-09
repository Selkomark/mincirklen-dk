import type { ReactNode } from 'react'
import {
  Tooltip as RACTooltip,
  TooltipTrigger,
  OverlayArrow,
  type TooltipProps as RACTooltipProps,
} from 'react-aria-components'
import './Tooltip.css'

export { TooltipTrigger }

export interface TooltipProps extends Omit<RACTooltipProps, 'className' | 'children'> {
  className?: string
  children: ReactNode
}

export function Tooltip({ children, className, offset = 8, ...props }: TooltipProps) {
  return (
    <RACTooltip
      className={['ds-tooltip', className].filter(Boolean).join(' ')}
      offset={offset}
      {...props}
    >
      <OverlayArrow>
        <svg className="ds-tooltip__arrow" width="8" height="8" viewBox="0 0 8 8">
          <path d="M0 0 L4 4 L8 0" />
        </svg>
      </OverlayArrow>
      {children}
    </RACTooltip>
  )
}
