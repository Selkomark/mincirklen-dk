import type { CSSProperties, ReactNode } from 'react'

// The DS Button renders a <button>, which has no href — real navigation needs a real <a>.
// Reusing Button's own CSS classes on an anchor keeps the identical look while staying a
// genuine, crawlable link (no target="_blank" — internal navigation stays in the same tab).
export function LinkButton({
  href,
  variant = 'safe',
  style,
  children,
}: {
  href: string
  variant?: 'safe' | 'secondary'
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <a href={href} className={`ds-button ds-button--${variant}`} style={{ textDecoration: 'none', ...style }}>
      {children}
    </a>
  )
}
