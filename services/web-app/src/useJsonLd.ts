import { useEffect } from 'react'

// Injects a JSON-LD <script> for the current page's structured data (WebSite,
// Organization, WebPage, etc.) — helps both search engines and AI answer engines
// understand what the page actually is, beyond the prose.
export function useJsonLd(data: object) {
  const json = JSON.stringify(data)

  useEffect(() => {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.textContent = json
    document.head.appendChild(script)
    return () => {
      script.remove()
    }
  }, [json])
}
