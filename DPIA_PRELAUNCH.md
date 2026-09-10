# DPIA pre-launch tracker

**This is not a Data Protection Impact Assessment.** It is the working
document that gets this platform ready for one: the legal structure a
real DPIA must follow, the determinations still open, the engineering
gaps that keep residual risk high, and the process for finalizing it
with a lawyer and/or Datatilsynet before launch. Treat every determination
below marked *"needs legal input"* as unresolved until a qualified person
signs off on it — nothing in this file is legal advice.

Cross-referenced against `CHARTER.md`, `docs/roadmap.md` §3.2,
`docs/gdpr-runbook.md`, `SECURITY_FINDINGS.md` (review date 2026-08-26),
`SECURITY.md`, and `services/web-app/src/publicPages/pages.ts`.

---

## 1. Why this is mandatory

Session content — what a person discloses inside a circle — is Article 9
special-category data (health/mental-health data) regardless of whether
account-level PII is collected. `docs/roadmap.md` §3.2 already states
this and that "we don't store PII" is not a valid exemption. Combined
with Article 9 processing at what is intended to become meaningful
scale, this triggers:

- **Article 35** — a DPIA is required before processing begins, not
  optional for "just a pilot."
- **Article 37(1)(c)** — a Data Protection Officer may be *mandatory*,
  not optional, if session-content processing counts as "core activity"
  involving large-scale special-category data. **Open — needs legal
  input.** See §3.

## 2. Required structure (Article 35(7))

No template is legally mandated, but Article 35(7) specifies the four
elements every adequate DPIA must contain, and EDPB WP248 rev.01 gives
the 9-criteria checklist regulators use to judge adequacy. Datatilsynet
publishes its own DPIA guidance and a list of processing types that
mandatorily require a DPIA under Article 35(4) — the final document
should be built on Datatilsynet's own template/checklist, not a generic
one, since they're the relevant supervisory authority.

The four required elements, and where this repo's evidence for each
currently lives:

1. **Systematic description of processing and purposes** — partially
   done. `privacy-policy` / `account-and-data` / `crisis-resources`
   public pages (`services/web-app/src/publicPages/pages.ts`) state
   legal basis, retention, and controller identity. `docs/gdpr-runbook.md`
   documents the ban/deletion/disclosure data flows. Not yet assembled
   into one systematic description covering every processing operation
   (message ingestion → moderation classification → storage → crisis
   escalation → retention/deletion → backups).
2. **Necessity and proportionality assessment** — not started. Needs to
   answer, per processing operation: is this the least invasive way to
   achieve the purpose, and is the purpose itself legitimate under the
   Charter's constraints.
3. **Risk assessment** — see §4. Real findings exist (`SECURITY_FINDINGS.md`)
   but haven't been reframed as data-subject risk with likelihood/severity
   ratings, which is what a DPIA risk register requires (not just a
   security-bug list).
4. **Measures envisaged** — partially done (moderation pipeline, crisis
   escalation per `CHARTER.md` §3, encryption via Vault/KMS for
   `user_profiles`). Gaps tracked in §4/§5.

## 3. DPO determination — needs legal input

Article 37(1)(c) requires a DPO when the controller's core activity
consists of processing, on a large scale, special categories of data
under Article 9. Arguments this applies here: session content *is* the
product, not an incidental byproduct, and Article 9 disclosure is
expected in the ordinary course of use, not an edge case. Arguments it
might not (yet): "large scale" is undefined by count in the GDPR text
and current usage is early-pilot scale.

**This needs a definitive legal read before the DPIA can be finalized** —
if a DPO is mandatory, Article 35(2) requires their input into the DPIA
itself, which changes who has to sign off before the document is done,
not just before launch.

## 4. Risk register (element 3 input)

Status as of this file's creation, cross-checked against
`SECURITY_FINDINGS.md` (review date 2026-08-26; H1 partially resolved
2026-09-10).

| # | Risk | Data-subject impact | Status |
|---|---|---|---|
| R1 | No rate limiting on OAuth callback / `sendMessage` (`SECURITY_FINDINGS.md` H1) | Bot-driven abuse can outpace moderation before a harmful message is caught | Partially resolved — free anonymous-session minting removed 2026-09-10; OAuth callback and `sendMessage` still uncapped |
| R2 | Unbounded message length (H2) | DoS / storage exhaustion; oversized payload reaches moderation and fans out to every room participant unfiltered | Open |
| R3 | No session revocation short of deleting the account; 180-day token (M1) | Can't forcibly cut off a compromised or predatory account's live access without deleting it outright | Open |
| R4 | WebSocket layer doesn't re-check verification/existence on connect (M2) | A revoked/deleted identity can retain live message delivery until reconnect | Open — currently mitigated by coincidence, not by design |
| R5 | Stack traces leak internal paths outside `NODE_ENV=production` (M3) | Reconnaissance value to an attacker in any misconfigured environment | Open |
| R6 | WS `ALLOWED_ORIGINS` fail-open, unset in compose (M4) | Removes a cross-site WebSocket protection layer in any environment that forgets to set it explicitly | Open |
| R7 | No CSP / `X-Frame-Options` / `nosniff` / `Referrer-Policy` (M5) | Clickjacking against an explicitly vulnerable user base; no second line of defense if XSS is ever introduced | Open |
| R8 | No production path exists for the ban / post-deletion disclosure-response actions except a manual database edit, which is disallowed by policy (nobody — including the platform owner — has standing production DB access; the sole exception is temporary, least-privilege, audited, NDA'd-employee access scoped to infrastructure duties, never to user content) | These actions therefore cannot legitimately be performed in production at all until they exist as real admin-platform actions — not a logging gap, a missing-capability gap. Until built, a real ban/disclosure request either can't be actioned, or gets actioned by a policy violation | Open — `TODO.md` "Admin page: GDPR/trust & safety tooling" now scopes this as a pre-launch blocker (corrected 2026-09-10; previously mis-scoped as an accepted-at-current-scale manual workaround in both `TODO.md` and `docs/gdpr-runbook.md`) |
| R9 | No breach-notification runbook | Article 33's 72-hour Datatilsynet notification clock has no defined decision-maker or process in this repo | Open |
| R10 | No documented duty-to-act boundary beyond in-session crisis response | Crisis language is actively detected (`moderation-service`); whether Danish law requires action beyond the Charter §3 in-session response (e.g. imminent third-party threat) is unanswered | Open — needs legal input |
| R11 | No age-gate / minimum-age policy found | If minors can join, consent basis changes to parental consent with added safeguarding duties | Open — needs a deliberate decision, not silence |
| R12 | Third-party processors (hosting, Vault/KMS, any SMS/email provider) not confirmed under DPAs | EU personal data flowing through a processor without a Data Processing Agreement is a direct compliance gap | Open |
| R13 | Backup deletion propagation unconfirmed | Retention policy says session content is deleted after safety review; not confirmed this reaches backups and not just the live table | Open |
| R14 | Facilitator/moderator access controls unconfirmed in code | Privacy policy states role-based access to message content; not verified this is enforced, logged, and covered by offboarding/NDA process | Open |

## 5. Engineering fix checklist — do before finalizing the risk section

Ordered by what blocks what. A DPIA finalized while these are open will
likely show high residual risk, which pushes this toward mandatory
Article 36 prior consultation with Datatilsynet rather than an
internally-filed document — closing these is what keeps that decision
in your control instead of the regulator's.

- [ ] R1 — rate limit OAuth callback and `sendMessage` (Redis already wired in, unused for throttling)
- [ ] R2 — add `.max(N)` to message body validation, enforced everywhere a message enters the system
- [ ] R3 — add logout endpoint + server-side revocation (token version / `token_epoch`); reconsider 180-day lifetime
- [ ] R4 — mirror `verifiedProcedure`'s check in the WS guard; re-check user existence on connect
- [ ] R5 — explicit `errorFormatter` stripping stack traces regardless of `NODE_ENV`; confirm prod runtime actually sets it
- [ ] R6 — fail closed (not open) when `ALLOWED_ORIGINS` is unset in any non-local environment
- [ ] R7 — add CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`
- [ ] R8 — build the real admin-platform ban-creation and disclosure-response actions (`TODO.md` items 2 and 4) on the existing RBAC system before either can legitimately happen in production; until then, no production ban or disclosure response is permitted, full stop — not "acceptable at current scale"
- [ ] R9 — write a breach-notification runbook: who decides, notification template, the 72-hour clock
- [ ] R12 — confirm DPA coverage for every third-party processor touching EU personal data; confirm EU/adequate-country hosting
- [ ] R13 — confirm deletion propagates to backups, not just the live table
- [ ] R14 — confirm facilitator/moderator access is enforced, logged, and covered by offboarding/NDA process matching `SECURITY.md`'s bar for repo access

## 6. Legal-process checklist

1. Close §5's engineering gaps, or explicitly accept and document any
   left open (with reasoning) as part of the necessity/proportionality
   section — a DPIA can acknowledge residual risk, it just can't ignore it.
2. Get a definitive legal read on the §3 DPO determination. If mandatory,
   involve them in the rest of this process, not just at the end.
3. Get a definitive legal read on R10 (duty-to-act boundary) and R11
   (minors policy) — both change what the DPIA has to say about consent
   basis and safeguarding, so they need answers before the description
   and risk sections can be called complete.
4. Assemble the four Article 35(7) elements (§2) into the actual DPIA
   document, using Datatilsynet's published DPIA template/guidance as
   the structural basis rather than a generic one.
5. Have a lawyer (GDPR-specialized, ideally Danish) or the DPO (if
   appointed) review the completed draft before treating any of it as
   final.
6. Determine residual risk after §5's mitigations. If it's still high in
   any area, Article 36 makes supervisory-authority consultation
   mandatory before processing begins — submit the package Article 36(3)
   specifies (responsibilities of controller/processors, purposes and
   means, safeguards, DPO contact if applicable, the DPIA itself) and
   wait for Datatilsynet's response (up to 8 weeks, extendable 6 more for
   complex cases). This is a regulatory function, not a paid
   certification service — confirm current submission procedure directly
   with Datatilsynet.
7. If residual risk is acceptable, no submission is required — the
   finished DPIA is kept on file as Article 5(2) accountability
   documentation, reviewed and updated whenever processing changes
   materially, and produced if ever requested during an investigation or
   complaint.
8. Either way: don't treat this document, or the finished DPIA, as a
   one-time artifact. Re-open it when a new feature changes what data is
   processed or how (e.g. the admin platform's RBAC bootstrap already
   noted in `CHARTER.md` principle 4 as the first feature relying on the
   operational-data exception).
