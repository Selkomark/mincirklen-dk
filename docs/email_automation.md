# Email: outbound delivery (built) and inbound automation (TODO)

Status: **outbound built, inbound not started.** Provider: **AhaSend** for
both directions, so the transactional emails going out today and the
inbound record-request automation planned below share one domain setup
and one set of credentials.

## Outbound, as built

### Pieces

- **Templates — `packages/emails` (`@mincirklen/emails`).** One React
  component per email under `src/templates/`, rendered on the server with
  `react-dom/server`'s static markup inside a shared `Layout` (brand line,
  body, "who sent this, no reply needed" footer). `renderEmail(key,
  language, variables)` validates the variables against the template's
  zod schema, renders, and derives the plain-text part from the HTML
  (`htmlToText.ts`), so every email goes out multipart from one source.
  Each template carries `sampleVariables` for the admin preview and a
  per-language strings table (`strings.en`, optional `da`/`sv`) that falls
  back to English key by key — the i18n hook exists, only English copy is
  written. The template catalog is typed against
  `EMAIL_TEMPLATE_KEYS` in `packages/shared/src/schemas/email.ts`, so a
  key without a template fails typecheck.
- **Transport — `services/trpc-api/src/adapters/`.** `EmailSender`
  (`emailAdapter.ts`) is the seam: `sendEmail({ to, subject, html, text })
  → { providerMessageId }`. Two implementations: the logging sender
  (`EMAIL_PROVIDER` unset or `log`; writes the masked recipient, subject
  and text to the server log, delivers nothing) and `ahasendEmailAdapter.ts`
  (`EMAIL_PROVIDER=ahasend`; `POST {AHASEND_API_URL}/accounts/{id}/messages`
  with a bearer token, a 10 s timeout, and an `AhaSendError` that keeps the
  HTTP status). Selected in `index.ts` the same way `KMS_PROVIDER` is.
- **The send — `services/emailService.ts`.** `sendToMember(deps, userId,
  templateKey, variables)` and `sendToAddress(deps, { to, templateKey,
  variables, … })`. Render → suppression check → write an `email_messages`
  row (status `queued`) → transport → mark `sent` with the provider id, or
  `failed` with the error. A member's address and profile language come
  from one query (`findEmailAndLanguageForUser`); unset language means
  English. Best-effort throughout: a report, decision, ban or gate grant
  never fails because an email didn't go out. Routers call
  `createEmailServiceDeps(ctx.appEnv)` and name a template key.
- **The record — three tables (migration 0016).** `email_messages`: one
  row per send with the template key, language, variables (jsonb), masked
  recipient, HMAC of the recipient under `EMAIL_HASH_KEY`
  (`auth/emailHash.ts`), optional `user_id`, subject, status, provider
  message id, error, `is_test`. **Never the rendered body** — the admin
  preview re-renders from template + variables. `email_events`: every
  provider webhook delivery, keyed uniquely by its `webhook-id` so retries
  and replays are no-ops, with the recipient address stripped from the
  stored payload. `email_suppressions`: addresses the provider has stopped
  delivering to, hash + mask only.
- **Status rules — `services/emailStatus.ts`.** `queued → sent → accepted
  → delayed → delivered → opened → clicked`, forward only; `bounced`,
  `failed`, `suppressed`, `complained` are terminal and never overwritten
  by a later happy-path event.
- **The webhook — `controllers/emailWebhookController.ts`.** `POST
  /webhooks/ahasend` on trpc-api (`https://trpc.<host>/webhooks/ahasend`).
  Verifies the Standard Webhooks signature (`webhook-id`,
  `webhook-timestamp`, `webhook-signature`; HMAC-SHA256 over
  `id.timestamp.body` under `AHASEND_WEBHOOK_SECRET`, ±5 min) in
  `auth/standardWebhookSignature.ts`. 503 until the secret is set, 401
  unsigned, 400 not-an-event, 500 only if the event could not be stored
  (so the provider retries), otherwise 200. `services/emailWebhookService.ts`
  stores the event, moves the matching message's status, and upserts
  suppressions from `suppression.created`.
- **Admin — `/manage/emails`** (`services/web-app/src/pages/manage/EmailsTab.tsx`),
  behind `emails.read` (migration 0017): 30-day counters, the paged sent
  log with a status filter, per message the metadata, the provider's event
  timeline and a preview in a sandboxed frame; the template catalog with
  language and variables editable and a live preview; the suppression
  list. `emails.send_test` adds "send this template to an address",
  recorded with `is_test`. Recipients show masked unless the viewer holds
  `users.read_pii` and the member's row still exists to decrypt from.

### Configuration

| Variable | Meaning |
|---|---|
| `EMAIL_PROVIDER` | `log` (default) or `ahasend` |
| `AHASEND_ACCOUNT_ID`, `AHASEND_API_KEY`, `AHASEND_DEFAULT_FROM` | required for `ahasend` |
| `AHASEND_DEFAULT_FROM_NAME` | optional display name |
| `AHASEND_API_URL` | defaults to `https://send.ahasend.com/v2` |
| `AHASEND_WEBHOOK_SECRET` | the `whsec_…`/`aha-whsec-…` signing secret; webhook route is 503 without it |
| `EMAIL_HASH_KEY` | required; keys the recipient hash — its own secret |

Dev values are in `docker-compose.yml`; real ones belong in `.env`
(gitignored) locally and in the deployment's secret store otherwise.

### Local testing

- Default (`log`): grant a gate signup or decide a report in /manage,
  read the `[EMAIL]` line in `docker compose logs trpc-api`, and find the
  row under /manage/emails → Sent.
- Real provider: set `EMAIL_PROVIDER=ahasend` and the `AHASEND_*` values
  in `.env`, `docker compose up -d trpc-api`, send a test from
  /manage/emails → Templates. For the webhook, either run the CLI on
  your host (`ahasend routes listen --forward-to
  https://trpc.dev-mincirklen.dk/webhooks/ahasend`) or bring up the
  containerized version instead:
  `docker compose --profile ahasend-webhook up -d ahasend-webhook-forwarder`
  (needs `AHASEND_API_KEY`/`AHASEND_ACCOUNT_ID` already in `.env` — see
  that service's own comment in `docker-compose.yml`). Either way it
  prints a **fresh** webhook signing secret to its own log every time it
  starts (`docker compose logs -f ahasend-webhook-forwarder`) — copy
  that into `AHASEND_WEBHOOK_SECRET` in `.env` and
  `docker compose up -d trpc-api` before the route will accept anything,
  then watch the message's timeline fill in.
- Tests: `bun test` in `packages/emails` (rendering, wording rules) and
  `services/trpc-api` (adapter against an in-process fake server,
  signature verification, status rules, webhook end to end, the
  `emails.*` router).

### Still to do on the outbound side

- Danish and Swedish copy in each template's `strings` table.
- Production domain setup (SPF/DKIM) and the webhook subscription
  (`--events all`).

## Prerequisite before any inbound automation: an email key on the ban

Today a ban row cannot be found from an email address. It is keyed by the
OAuth identity hash, and the account's `email_ciphertext` lives on the
`users` row, which is deleted when the person deletes their account — the
exact moment this request flow matters most.

So the first piece of inbound work is a migration that adds **`email_hash`**
to `account_bans`: the HMAC `auth/emailHash.ts` already computes for
sent-email rows, under the same `EMAIL_HASH_KEY`, written at ban time by
`banService.ts` from the decrypted address. The inbound handler then hashes
the requester's stated address the same way and looks the record up by it.
No plaintext email is stored; no existing row changes meaning. Back-fill is
not possible for bans issued before the migration whose accounts are gone;
those stay request-by-hand.

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
   envelope `from`), normalise, HMAC with `EMAIL_HASH_KEY` (`auth/emailHash.ts`), find
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
  `ahasend routes listen --forward-to https://trpc.dev-mincirklen.dk/<webhook-path>`
  (the dev hostnames are the Caddy ones — see `docs/local_dev.md`; never
  `localhost:port`) — or the containerized `ahasend-webhook-forwarder`
  service (`docker-compose.yml`), which forwards container-to-container
  instead and needs no Caddy/DNS/cert setup. Same CLI, same
  fresh-secret-per-run caveat, either way.
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
