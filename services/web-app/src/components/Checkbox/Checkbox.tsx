import type { ReactNode } from 'react'
import { Checkbox as RACCheckbox, type CheckboxProps as RACCheckboxProps } from 'react-aria-components'
import './Checkbox.css'

export interface CheckboxProps extends Omit<RACCheckboxProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

export function Checkbox({ children, className, ...props }: CheckboxProps) {
  return (
    <RACCheckbox className={['ds-checkbox', className].filter(Boolean).join(' ')} {...props}>
      <div className="ds-checkbox__box">
        <svg className="ds-checkbox__check" viewBox="0 0 18 18" aria-hidden="true">
          <polyline points="2 9 7 14 16 3" />
        </svg>
        <span className="ds-checkbox__dash" aria-hidden="true" />
      </div>
      {children}
    </RACCheckbox>
  )
}
