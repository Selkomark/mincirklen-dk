# Email: outbound delivery and inbound automation (TODO)

Status: **not built**. This is the plan and the reference material for when
email moves off the logging stand-in. Nothing here is live; the only email
code in the repo today is `services/trpc-api/src/adapters/emailAdapter.ts`,
which writes the would-be message to the server log and delivers nothing.

Provider chosen: **AhaSend** — one service for both directions, so outbound
moderation emails and the inbound record-request automation share one
domain setup and one set of credentials.

## What exists already (the seams this plugs into)

- **Outbound.** `createLoggingEmailSender()` implements `EmailSender`
  (`sendEmail({ to, subject, text })`). One instance is created in
  `services/trpc-api/src/controllers/memberEmail.ts` and every
  report-lifecycle email goes through `emailMember(...)`, which resolves the
  member's address server-side and never throws. Templates are pure
  functions in `services/trpc-api/src/services/moderationEmails.ts`:
  report received, report decided, member warned / removed / messages
  hidden / account closed. Swapping the sender is one line in
  `memberEmail.ts`; the service layer does not change.
- **The inbound trigger.** The privacy policy's "If your account was
  closed" section (`services/web-app/src/publicPages/pages.ts`) opens a
  mailto with a fixed subject, `Closed account — request for record`, and a
  one-field body: the email address the account used. That subject is the
  automation's match key; that address is its lookup key.
- **The record.** `account_bans` (+ `account_ban_evidence`) holds the
  reason category, the decision summary, the evidence snapshots and
  `banned_by`. Written by `services/trpc-api/src/services/banService.ts`,
  one row per linked sign-in identity, keyed by identity hash so it
  survives account deletion. See `docs/gdpr-runbook.md` for the disclosure
  logic this exists to serve.

## Prerequisite before any inbound automation: an email key on the ban

Today a ban row cannot be found from an email address. It is keyed by the
OAuth identity hash, and the account's `email_ciphertext` lives on the
`users` row, which is deleted when the person deletes their account — the
exact moment this request flow matters most.

So the first piece of work, independent of AhaSend, is a migration that
adds **`email_hash`** to `account_bans`: an HMAC of the lowercased,
trimmed address under a dedicated key (same key-separation posture as
`IDENTITY_HASH_KEY` — a new env var, not a reuse), written at ban time by
`banService.ts` from the decrypted address. The inbound handler then
hashes the requester's stated address the same way and looks the record
up by it. No plaintext email is stored; no existing row changes meaning.
Back-fill is not possible for bans issued before the migration whose
accounts are gone; those stay request-by-hand.

## Outbound: replace the stand-in

1. Verify the sending domain in the AhaSend dashboard (DNS TXT), set up
   SPF/DKIM as it instructs.
2. New adapter `services/trpc-api/src/adapters/ahasendEmailAdapter.ts`
   implementing `EmailSender` over AhaSend's send API; API key via env
   (`AHASEND_API_KEY`), from-address via env (`EMAIL_FROM`). Keep the
   logging sender for local dev behind a flag (`EMAIL_PROVIDER=log|ahasend`),
   mirroring how `KMS_PROVIDER` selects Vault vs GCP in
   `services/trpc-api/src/index.ts`.
3. Unit-test the adapter against an in-process fake HTTP server, the way
   `websocketServiceAdapter.test.ts` does, covering success, a 4xx, and a
   network failure — `emailMember` must keep swallowing failures.
4. Translate the templates. The member's language is on their profile;
   `moderationEmails.ts` currently returns English only. Thread a
   language through and keep the two wording rules (a reporter never
   learns what was done to anyone else; a member acted on never learns who
   reported them).
5. Bounce/complaint handling: at minimum log them; consider marking the
   address undeliverable so repeated sends stop.

## Inbound: closed-account record requests

Architecture, following the reference below: push-based, no IMAP polling.
AhaSend receives mail on a dedicated address, parses it, and POSTs JSON to
us; we match on the subject and act.

1. **AhaSend side.** MX records for the receiving (sub)domain → AhaSend,
   priority 10. One inbound route matching the request address (e.g.
   `records@…`) with our webhook URL as the destination.
2. **Where the webhook lives.** trpc-api, as a Hono route alongside the
   OAuth callback (`services/trpc-api/src/controllers/`), not a new
   service — it needs the DB, the KMS and the email sender, all already in
   `AppEnv`. Clean Architecture applies: the controller validates and
   acknowledges; a service decides; repositories read the ban ledger.
3. **Verify the sender.** Reject anything without a valid AhaSend webhook
   signature (per their docs) before parsing. Add the signing secret to env.
   This endpoint is on the public internet and triggers a disclosure.
4. **Acknowledge fast, work after.** Return 200 as soon as the payload is
   validated — AhaSend retries on timeouts — and do the lookup and reply
   asynchronously (the Pub/Sub pipeline the data export already uses is
   the natural fit; see `services/trpc-api/src/services/dataExportRequestService.ts`).
5. **Match.** Subject equals `Closed account — request for record`
   (case-insensitive, trimmed; tolerate `Re:`/`Fwd:` prefixes). Anything
   else: acknowledge and drop. Never reply to non-matching mail — it would
   confirm the address receives.
6. **Lookup.** Take the address from the one-field body (fall back to the
   envelope `from`), normalise, HMAC with the email-hash key, find
   `account_bans` rows by `email_hash`. Only ever reply **to the address
   found in the record**, never to the `from` — the body is attacker
   controlled. If `from` and the stated address differ, still reply only to
   the record's address.
7. **Reply.** The disclosure: reason category, `decision_summary`,
   `banned_at`, and the evidence snapshots (`account_ban_evidence`), in the
   wording `docs/gdpr-runbook.md` sets out. One reply per request. If no
   record matches, a short "we found no closed account for this address"
   reply — to the stated address only if it is also the `from`, otherwise
   nothing.
8. **Idempotency and rate.** Store AhaSend's message `id` and skip repeats.
   Cap replies per address per day (one is enough) so the endpoint can't be
   used to spam someone with their own record.
9. **Audit.** Log each request and reply (hashed address, record id,
   outcome) — this is a data disclosure and should be traceable.

## Development and testing

- AhaSend CLI forwards real inbound events to a local server:
  `ahasend routes listen --forward-to https://api.dev-mincirklen.dk/<webhook-path>`
  (the dev hostnames are the Caddy ones — see `docs/local_dev.md`; never
  `localhost:port`).
- Integration test the webhook with a recorded payload and a seeded ban
  row carrying an `email_hash`, asserting the reply goes to the record's
  address and that a mismatched `from` gets nothing.

## Reference: the approach this is based on

The following is the documentation the plan above adapts. Kept verbatim so
the original shape of the solution stays available; the sections above
say how it maps onto this codebase (Hono on Bun, not Express; the
subject/address keys above, not the invoice example).

---

### Internal Technical Documentation: Inbound Email Automation System

This document outlines the architecture and implementation steps for
building an automated workflow triggered by incoming emails using AhaSend
and a custom backend application.

#### Architectural Overview

The system relies on an event-driven, push-based architecture rather than
polling IMAP servers or parsing raw MIME streams.

- AhaSend Ingestion Layer: Receives incoming SMTP mail on verified
  domains, parses the message data, and translates it into a structured
  JSON payload delivered via HTTP POST.
- Backend Gateway Layer: Receives the webhook payload, evaluates the
  subject line against predefined business rules, and triggers the
  automation engine if a match occurs.

#### Setting Up AhaSend Ingestion

1. Domain Verification: Register and verify your sending or receiving
   domain in the AhaSend Dashboard via DNS TXT records.
2. Configure MX Records: Set your domain MX records to point to
   `ahasend.com` with priority 10.
3. Create an Inbound Route: Set the match pattern to a target address or
   wildcard and provide your backend endpoint URL.

#### Webhook Payload Structure

AhaSend transmits the parsed message using the following JSON schema:

```json
{
  "id": "msg_01h7x89...",
  "from": "sender@externaldomain.com",
  "to": ["trigger@yourdomain.com"],
  "subject": "[URGENT] Process Invoice #4829",
  "text_body": "Please find the automated processing request below...",
  "html_body": "<p>Please find the automated processing request below...</p>",
  "attachments": []
}
```

#### Backend Implementation and Subject Filtering

The backend endpoint parses incoming JSON payloads, validates the subject
line, and immediately responds with an HTTP 200 status to prevent timeout
retries from AhaSend.

```javascript
const express = require('express');
const app = express();

app.use(express.json());

app.post('/v1/webhooks/inbound-email', async (req, res) => {
    try {
        const { subject, from, text_body, attachments } = req.body;

        const triggerKeywords = ['URGENT', 'INVOICE', 'AUTOMATION RUN'];
        const isMatch = triggerKeywords.some(keyword =>
            subject.toUpperCase().includes(keyword.toUpperCase())
        );

        if (!isMatch) {
            return res.status(200).send('Webhook acknowledged: Criteria not met.');
        }

        await executeAutomationWorkflow({ subject, from, text_body, attachments });
        return res.status(200).send('Webhook processed successfully.');

    } catch (error) {
        console.error('Error processing inbound email webhook:', error);
        return res.status(500).send('Internal Server Error');
    }
});

async function executeAutomationWorkflow(emailData) {
    // Custom automation code goes here
}

app.listen(3000, () => console.log('Email Webhook Listener running on port 3000'));
```

#### Development and Testing

Use the AhaSend CLI to forward production inbound events securely to a
local server during development:

```bash
ahasend routes listen --forward-to http://localhost:3000/v1/webhooks/inbound-email
```
