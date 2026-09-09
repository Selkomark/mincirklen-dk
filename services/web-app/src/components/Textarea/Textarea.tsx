import { forwardRef, useId, type TextareaHTMLAttributes } from 'react'
import './Textarea.css'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, id, className, rows = 4, ...props }, ref) => {
    const generatedId = useId()
    const textareaId = id ?? generatedId
    return (
      <div className={['ds-textarea', className].filter(Boolean).join(' ')}>
        <label className="ds-textarea__label" htmlFor={textareaId}>
          {label}
        </label>
        <textarea ref={ref} id={textareaId} className="ds-textarea__input" rows={rows} {...props} />
        {hint && <span className="ds-textarea__hint">{hint}</span>}
      </div>
    )
  },
)

Textarea.displayName = 'Textarea'
