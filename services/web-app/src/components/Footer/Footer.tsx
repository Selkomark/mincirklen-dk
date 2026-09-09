import type { HTMLAttributes, ReactNode } from 'react'
import { Container } from '../Container'
import './Footer.css'

export interface FooterProps extends HTMLAttributes<HTMLElement> {
  /** FooterColumn elements. */
  children?: ReactNode
  /** Copyright / legal line at the bottom. */
  bottom?: ReactNode
}

export function Footer({ children, bottom, className, ...props }: FooterProps) {
  return (
    <footer className={['ds-footer', className].filter(Boolean).join(' ')} {...props}>
      <Container>
        <div className="ds-footer__columns">{children}</div>
        {bottom && <div className="ds-footer__bottom">{bottom}</div>}
      </Container>
    </footer>
  )
}

export interface FooterColumnProps {
  title: string
  children: ReactNode
}

export function FooterColumn({ title, children }: FooterColumnProps) {
  return (
    <div className="ds-footer__column">
      <div className="ds-footer__column-title">{title}</div>
      <div className="ds-footer__column-links">{children}</div>
    </div>
  )
}
