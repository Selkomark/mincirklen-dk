import type { BlockquoteHTMLAttributes } from 'react'
import './Blockquote.css'

export interface BlockquoteProps extends BlockquoteHTMLAttributes<HTMLQuoteElement> {}

export function Blockquote({ className, ...props }: BlockquoteProps) {
  return <blockquote className={['ds-blockquote', className].filter(Boolean).join(' ')} {...props} />
}
