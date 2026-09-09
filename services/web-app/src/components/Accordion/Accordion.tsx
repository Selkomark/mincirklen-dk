import type { ReactNode } from 'react'
import {
  DisclosureGroup,
  Disclosure,
  DisclosurePanel,
  Heading,
  Button,
  type DisclosureGroupProps,
  type DisclosureProps,
} from 'react-aria-components'
import './Accordion.css'

export function Accordion({ className, ...props }: DisclosureGroupProps) {
  return (
    <DisclosureGroup className={['ds-accordion', className].filter(Boolean).join(' ')} {...props} />
  )
}

export interface AccordionItemProps extends Omit<DisclosureProps, 'className' | 'children'> {
  title: string
  className?: string
  children: ReactNode
}

export function AccordionItem({ title, children, className, ...props }: AccordionItemProps) {
  return (
    <Disclosure className={['ds-accordion-item', className].filter(Boolean).join(' ')} {...props}>
      <Heading className="ds-accordion-item__heading">
        <Button slot="trigger" className="ds-accordion-item__trigger">
          <span>{title}</span>
          <span className="ds-accordion-item__chevron" aria-hidden="true">
            ⌄
          </span>
        </Button>
      </Heading>
      <DisclosurePanel className="ds-accordion-item__panel">{children}</DisclosurePanel>
    </Disclosure>
  )
}
