import type { ReactNode } from 'react'
import {
  RadioGroup as RACRadioGroup,
  Radio as RACRadio,
  Label,
  type RadioGroupProps as RACRadioGroupProps,
  type RadioProps as RACRadioProps,
} from 'react-aria-components'
import './RadioGroup.css'

export interface RadioGroupProps extends Omit<RACRadioGroupProps, 'className' | 'children'> {
  label?: string
  className?: string
  children?: ReactNode
}

export interface RadioProps extends Omit<RACRadioProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

export function RadioGroup({ label, children, className, ...props }: RadioGroupProps) {
  return (
    <RACRadioGroup className={['ds-radio-group', className].filter(Boolean).join(' ')} {...props}>
      {label && <Label className="ds-radio-group__label">{label}</Label>}
      <div className="ds-radio-group__options">{children}</div>
    </RACRadioGroup>
  )
}

export function Radio({ children, className, ...props }: RadioProps) {
  return (
    <RACRadio className={['ds-radio', className].filter(Boolean).join(' ')} {...props}>
      <span className="ds-radio__dot" />
      {children}
    </RACRadio>
  )
}
