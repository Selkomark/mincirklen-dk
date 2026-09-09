import { useState, type HTMLAttributes, type ReactNode } from 'react'
import { Container } from '../Container'
import { IconButton } from '../IconButton'
import './Navbar.css'

export interface NavbarProps extends HTMLAttributes<HTMLElement> {
  logo: ReactNode
  /** Nav links + actions, right-aligned on desktop. Collapses into a hamburger menu below 768px. */
  children?: ReactNode
  sticky?: boolean
}

export function Navbar({ logo, children, sticky = false, className, ...props }: NavbarProps) {
  const [open, setOpen] = useState(false)

  return (
    <header
      className={['ds-navbar', sticky && 'ds-navbar--sticky', className].filter(Boolean).join(' ')}
      {...props}
    >
      <Container className="ds-navbar__inner">
        <div className="ds-navbar__logo">{logo}</div>
        {children && (
          <IconButton
            className="ds-navbar__toggle"
            icon={open ? '✕' : '☰'}
            label={open ? 'Close menu' : 'Open menu'}
            onPress={() => setOpen((o) => !o)}
          />
        )}
        <nav className={['ds-navbar__links', open && 'ds-navbar__links--open'].filter(Boolean).join(' ')}>
          {children}
        </nav>
      </Container>
    </header>
  )
}
