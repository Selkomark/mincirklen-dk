import type { ReactNode } from 'react'
import {
  Modal as RACModal,
  ModalOverlay,
  Dialog,
  Heading,
  DialogTrigger,
  type ModalOverlayProps,
} from 'react-aria-components'
import './Modal.css'

export { DialogTrigger }

export interface ModalProps extends Omit<ModalOverlayProps, 'className' | 'children'> {
  title?: string
  className?: string
  children: ReactNode | ((close: () => void) => ReactNode)
}

export function Modal({ title, children, className, isDismissable = true, ...props }: ModalProps) {
  return (
    <ModalOverlay className="ds-modal-overlay" isDismissable={isDismissable} {...props}>
      <RACModal className={['ds-modal', className].filter(Boolean).join(' ')}>
        <Dialog className="ds-modal__dialog">
          {({ close }) => (
            <>
              {title && (
                <Heading slot="title" className="ds-modal__title">
                  {title}
                </Heading>
              )}
              {typeof children === 'function' ? children(close) : children}
            </>
          )}
        </Dialog>
      </RACModal>
    </ModalOverlay>
  )
}
