import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import './CopyText.css'

export interface CopyTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  // What goes to the clipboard. Defaults to the rendered text when
  // `children` is a plain string.
  value?: string
  children: ReactNode
  // Accessible names for the button — English defaults so the Catalog
  // renders without i18n; the app passes translated strings.
  copyLabel?: string
  copiedLabel?: string
}

const CopyIcon = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

const CheckIcon = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// Inline text with a copy button that appears on hover or focus, sitting
// in the trailing edge so the text itself doesn't shift. Click copies
// `value` (or the text) and shows a check for a moment. For ids,
// addresses, keys — anything someone would otherwise triple-click and
// drag.
export function CopyText({ value, children, copyLabel = 'Copy', copiedLabel = 'Copied', className, ...props }: CopyTextProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const text = value ?? (typeof children === 'string' ? children : '')

  async function copy() {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be refused (permissions, insecure context);
      // nothing to do but leave the text selectable as it was.
    }
  }

  return (
    <span className={['ds-copy-text', copied && 'ds-copy-text--copied', className].filter(Boolean).join(' ')} {...props}>
      <span className="ds-copy-text__value">{children}</span>
      <button
        type="button"
        className="ds-copy-text__button"
        aria-label={copied ? copiedLabel : copyLabel}
        title={copied ? copiedLabel : copyLabel}
        onClick={() => void copy()}
      >
        {copied ? CheckIcon : CopyIcon}
      </button>
    </span>
  )
}
