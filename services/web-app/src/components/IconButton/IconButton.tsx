import type { ReactNode } from 'react'
import { Button as RACButton, type ButtonProps as RACButtonProps } from 'react-aria-components'
import './IconButton.css'

export type IconButtonVariant = 'default' | 'urgent'

export interface IconButtonProps extends Omit<RACButtonProps, 'className' | 'children'> {
  icon: ReactNode
  label: string
  variant?: IconButtonVariant
  className?: string
}

export function IconButton({ icon, label, variant = 'default', className, ...props }: IconButtonProps) {
  return (
    <RACButton
      aria-label={label}
      className={['ds-icon-button', `ds-icon-button--${variant}`, className].filter(Boolean).join(' ')}
      {...props}
    >
      {icon}
    </RACButton>
  )
}
