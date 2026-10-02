import type { ReactNode } from 'react'
import type { EmailLanguage, SignOff } from '../types'
import { resolveStrings } from '../i18n'

// The one frame every email shares: a brand line, the body, a footer
// that says who sent it and that no reply is needed. Inline styles and
// table layout only — mail clients ignore stylesheets and most CSS
// layout. Keep it plain; the body carries the message.

const LAYOUT_STRINGS = {
  en: {
    brand: 'MinCirklen',
    signOffModeration: "This message was sent by the MinCirklen moderation team. You don't need to reply.",
    signOffTeam: "This message was sent by the MinCirklen team. You don't need to reply.",
  },
}

const FONT_FAMILY = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'

export function Layout({ language, signOff, children }: { language: EmailLanguage; signOff: SignOff; children: ReactNode }) {
  const s = resolveStrings(LAYOUT_STRINGS, language)
  return (
    <html lang={language}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width" />
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: '#f4f4f2' }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#f4f4f2' }}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: '32px 16px' }}>
                <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ maxWidth: 560, backgroundColor: '#ffffff', borderRadius: 12 }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '24px 32px 0', fontFamily: FONT_FAMILY, fontSize: 16, fontWeight: 700, color: '#1f2a24' }}>{s.brand}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '16px 32px 8px', fontFamily: FONT_FAMILY, fontSize: 16, lineHeight: '24px', color: '#1f2a24' }}>{children}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '16px 32px 24px', fontFamily: FONT_FAMILY, fontSize: 13, lineHeight: '20px', color: '#6b746f' }}>
                        {signOff === 'moderation' ? s.signOffModeration : s.signOffTeam}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  )
}
