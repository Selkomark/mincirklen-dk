// Outbound email — currently a stand-in that only logs.
//
// TODO(email): this is NOT a delivery mechanism. `sendEmail` writes the
// message to the server log and returns; nothing reaches the member. It
// exists so the moderation "warn member" action (sessionReportService.ts)
// has a stable seam today. Replace the body with a real transport (SMTP
// or a provider API) behind this same signature — see TODO.md, "Email
// delivery", for what that involves. Keep the interface; change only the
// implementation.

export interface EmailMessage {
  to: string
  subject: string
  text: string
}

export interface EmailSender {
  sendEmail(message: EmailMessage): Promise<void>
}

// Masks the local part the same way rbacRepository.ts's maskEmail does,
// so even the mock never writes a full address to the log.
function maskRecipient(email: string): string {
  const atIndex = email.indexOf('@')
  if (atIndex <= 0) return '***'
  return `${email[0]}***@${email.slice(atIndex + 1)}`
}

export function createLoggingEmailSender(log: (line: string) => void = console.log): EmailSender {
  return {
    async sendEmail(message) {
      // TODO(email): replace with real delivery.
      log(`[EMAIL] (mock — not delivered) to=${maskRecipient(message.to)} subject=${JSON.stringify(message.subject)} chars=${message.text.length}`)
    },
  }
}
