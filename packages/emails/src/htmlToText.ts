// Derives the plain-text part from the rendered HTML, so every email
// goes out multipart and no template has to be written twice. Good
// enough for the markup Layout/Paragraph/Link produce — this is not a
// general HTML-to-text converter.
export function htmlToText(html: string): string {
  let s = html
  // Drop anything that isn't content.
  s = s.replace(/<!doctype[^>]*>/gi, '')
  s = s.replace(/<(head|style|script)\b[\s\S]*?<\/\1>/gi, '')
  // Links: "label (url)", or just the url when the label is the url.
  s = s.replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const label = decodeEntities(stripTags(inner).trim())
    const url = decodeEntities(href)
    return label === url || label === '' ? url : `${label} (${url})`
  })
  // Block boundaries become line breaks.
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, '\n\n')
  s = s.replace(/<li\b[^>]*>/gi, '- ')
  s = stripTags(s)
  s = decodeEntities(s)
  // Tidy: trailing spaces per line, at most one blank line in a row.
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/^[ \t]+/g, ''))
    .join('\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body] ?? match
  })
}
