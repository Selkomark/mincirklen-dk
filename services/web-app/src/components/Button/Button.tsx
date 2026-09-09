import { Button as RACButton, type ButtonProps as RACButtonProps } from 'react-aria-components'
import { Spinner } from '../Spinner'
import './Button.css'

export type ButtonVariant = 'safe' | 'secondary' | 'ghost' | 'urgent'

export interface ButtonProps extends Omit<RACButtonProps, 'className'> {
  variant?: ButtonVariant
  className?: string
  /** Shows a spinner and forces the button disabled — use for any button that triggers a backend call. */
  isPending?: boolean
}

export function Button({ variant = 'safe', className, isPending, isDisabled, children, ...props }: ButtonProps) {
  return (
    <RACButton
      className={['ds-button', `ds-button--${variant}`, className].filter(Boolean).join(' ')}
      isDisabled={isPending || isDisabled}
      aria-busy={isPending || undefined}
      {...props}
    >
      {(renderProps) => (
        <>
          {isPending && <Spinner size={16} />}
          {typeof children === 'function' ? children(renderProps) : children}
        </>
      )}
    </RACButton>
  )
}
