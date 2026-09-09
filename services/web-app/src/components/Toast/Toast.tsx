import {
  UNSTABLE_ToastRegion as ToastRegion,
  UNSTABLE_Toast as RACToast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  Text,
  Button,
} from 'react-aria-components'
import './Toast.css'

export type ToastVariant = 'info' | 'safe' | 'urgent'

export interface ToastData {
  title: string
  variant?: ToastVariant
}

export const toastQueue = new ToastQueue<ToastData>({ maxVisibleToasts: 3 })

export function addToast(title: string, options?: { variant?: ToastVariant; timeout?: number }) {
  return toastQueue.add(
    { title, variant: options?.variant ?? 'info' },
    { timeout: options?.timeout ?? 5000 },
  )
}

// `dismissLabel` isn't translated internally — this component is shared
// with the (English-only) design system Catalog, which mounts its own
// `<ToastRegionRoot />` with no i18next instance initialized. The real
// app's mount point (App.tsx) passes its own translated string; Catalog
// keeps the English default.
export function ToastRegionRoot({ dismissLabel = 'Dismiss' }: { dismissLabel?: string } = {}) {
  return (
    <ToastRegion queue={toastQueue} className="ds-toast-region">
      {({ toast }) => (
        <RACToast toast={toast} className={`ds-toast ds-toast--${toast.content.variant ?? 'info'}`}>
          <ToastContent className="ds-toast__content">
            <Text slot="title">{toast.content.title}</Text>
          </ToastContent>
          <Button slot="close" className="ds-toast__close" aria-label={dismissLabel}>
            ✕
          </Button>
        </RACToast>
      )}
    </ToastRegion>
  )
}
