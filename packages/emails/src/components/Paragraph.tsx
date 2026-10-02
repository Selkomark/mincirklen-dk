import type { ReactNode } from 'react'

// Newlines in a moderator's own text are kept (pre-wrap), so a warning
// written in two paragraphs arrives in two paragraphs.
export function Paragraph({ children }: { children: ReactNode }) {
  return <p style={{ margin: '0 0 16px', whiteSpace: 'pre-wrap' }}>{children}</p>
}
