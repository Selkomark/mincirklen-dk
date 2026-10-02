// A plain, underlined link. htmlToText renders it as "label (url)", or
// just the url when the label is the url itself.
export function Link({ href, children }: { href: string; children?: string }) {
  return (
    <a href={href} style={{ color: '#2f6b4f', textDecoration: 'underline', wordBreak: 'break-all' }}>
      {children ?? href}
    </a>
  )
}
