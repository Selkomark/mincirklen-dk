// Outbound email transport. Two implementations: this file's logging
// sender (EMAIL_PROVIDER=log — local dev, writes the would-be message to
// the server log and delivers nothing) and ahasendEmailAdapter.ts
// (EMAIL_PROVIDER=ahasend — delivers). Both sit behind EmailSender; the
// service layer (services/emailService.ts) only ever sees that.

export interface OutboundEmail {
  to: string
  subject: string
  html: string
  text: string
}

export interface EmailSendResult {
  // The provider's id for the message, which its webhooks later refer
  // to. Null when the transport has none (the logging sender).
  providerMessageId: string | null
}

export interface EmailSender {
  sendEmail(message: OutboundEmail): Promise<EmailSendResult>
}

// Masks the local part the same way rbacRepository.ts's maskEmail does,
// so even the dev sender never writes a full address to the log. The
// text body IS logged in full — that's the point while nothing is
// delivered: it's the only way to see what a member would be told.
function maskRecipient(email: string): string {
  const atIndex = email.indexOf('@')
  if (atIndex <= 0) return '***'
  return `${email[0]}***@${email.slice(atIndex + 1)}`
}

export function createLoggingEmailSender(log: (line: string) => void = console.log): EmailSender {
  return {
    async sendEmail(message) {
      log(
        [
          `[EMAIL] (log provider — not delivered) to=${maskRecipient(message.to)}`,
          `  subject: ${message.subject}`,
          ...message.text.split('\n').map((line) => `  | ${line}`),
        ].join('\n'),
      )
      return { providerMessageId: null }
    },
  }
}
