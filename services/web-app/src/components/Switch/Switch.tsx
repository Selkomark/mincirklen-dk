import type { ReactNode } from 'react'
import { Switch as RACSwitch, type SwitchProps as RACSwitchProps } from 'react-aria-components'
import './Switch.css'

export interface SwitchProps extends Omit<RACSwitchProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

export function Switch({ children, className, ...props }: SwitchProps) {
  return (
    <RACSwitch className={['ds-switch', className].filter(Boolean).join(' ')} {...props}>
      <div className="ds-switch__track">
        <div className="ds-switch__thumb" />
      </div>
      {children}
    </RACSwitch>
  )
}
