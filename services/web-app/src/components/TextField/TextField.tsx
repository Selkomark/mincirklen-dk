import { forwardRef, useId, type InputHTMLAttributes } from 'react'
import './TextField.css'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, hint, id, className, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    return (
      <div className={['ds-textfield', className].filter(Boolean).join(' ')}>
        <label className="ds-textfield__label" htmlFor={inputId}>
          {label}
        </label>
        <input ref={ref} id={inputId} className="ds-textfield__input" {...props} />
        {hint && <span className="ds-textfield__hint">{hint}</span>}
      </div>
    )
  },
)

TextField.displayName = 'TextField'
