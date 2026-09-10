# TODO

## Post-revenue: move moderation-service to GKE Autopilot + GPU + vLLM + Inference Gateway

Discussed 2026-09-04. Context: moderation-service currently runs Ollama (Qwen3-4B,
CPU) on Cloud Run — fine for launch-scale traffic. At meaningful scale (order
1000 req/sec), re-processing the same static system prompt on every classify
call becomes real, avoidable compute cost, and Cloud Run's stateless-fan-out
autoscaling model actively works against fixing that: prefix/KV-cache reuse
only pays off when repeat traffic keeps landing on the same warm instance,
which Cloud Run doesn't give you.

**The fix, deliberately deferred as one bundled move, not staged early:**

1. **GKE Autopilot cluster with a GPU node pool** — GPU both increases
   throughput and is the cheaper option per-request at real scale (vs. CPU),
   so this is the point where GPU spend actually pays for itself. Confirmed
   sound: Google publishes official Autopilot + vLLM tutorials for this exact
   model family (Qwen3), GPU support included, no Autopilot-specific
   restriction found.
2. **Swap Ollama → vLLM.** Not worth doing on CPU alone first — vLLM's real
   advantages (PagedAttention, continuous batching) are GPU-memory-bound
   optimizations; on CPU there's no verified evidence it beats Ollama/
   llama.cpp (which is CPU-optimized as a primary design goal), and vLLM's
   CPU backend has a hard AVX512 requirement GKE Autopilot doesn't guarantee
   by default. Do this together with the GPU move, not before it.
3. **Turn on GKE Inference Gateway** (built on the Gateway API Inference
   Extension) for KV-cache-aware routing — hashes the incoming prompt's
   token prefix and routes each request to the replica most likely already
   holding it cached. Confirmed: works on Autopilot explicitly, vLLM is its
   default/reference backend (Ollama is not a documented supported backend,
   which is the other reason this waits for the vLLM swap). Real-world
   reference point: Snap reported 75-80% prefix cache hit rates running this
   in production.
4. **Prerequisites to account for when this is scoped for real**: GKE
   1.32.3+, VPC-native cluster (Autopilot default), a reserved proxy-only
   subnet for the load balancer (new addition to `IaC/modules/networking`),
   the `HttpLoadBalancing` add-on, and one of the two supported GatewayClasses
   (`gke-l7-rilb` / `gke-l7-regional-external-managed`).

**What's already done, independent of timing**: VML's compiled prompts put
static content (role, constraints, category definitions) before the one
thing that varies per request (the message being classified) — a
zero-cost discipline that makes prefix caching effective the moment it's
turned on, without waiting on any of the above.

## Before going live: split deployment into a private repo

Decided during a pre-launch security review (2026-08-16): this repo is
public so people can fork and contribute, but GitHub ties Actions
visibility to repo visibility — there's no way to hide the Actions tab or
workflow run logs on a public repo. `iac-apply.yml` is the one workflow
that can mutate real infrastructure, so it shouldn't run in public view.

Plan:

1. Create a new **private** repo (e.g. `Selkomark/MinCirklen.dk-deploy`)
   that holds `IaC/` and `.github/workflows/iac-apply.yml` (and
   `iac-plan.yml` if plan output shouldn't be public either).
2. Re-point the GCP Workload Identity Federation trust condition
   (currently `assertion.repository == "Selkomark/MinCirklen.dk"` — see
   `IaC/bootstrap/main.tf` and `IaC/scripts/setup-gcp.sh`) at the new
   private repo's identity instead.
3. Remove `IaC/` and the iac-*.yml workflows from this public repo once
   the private one is verified working, or keep read-only copies here for
   contributor visibility with the actual apply logic only in the private
   repo.
4. This was already anticipated in `iac-apply.yml`'s own comments (tech
   spec section 7.3, "repo/pipeline split") — not a new idea, just
   executing on it.

This also simplifies the current fork-PR-approval-gate concern: once
`iac-apply.yml`/`iac-plan.yml` live in a private repo, external
contributors to the public repo have no path to trigger WIF-authenticated
GCP workflows at all, regardless of Actions approval settings.

## Restrict platform access to supported-language countries

Discussed 2026-09-04: current focus is English/Danish/Swedish (Norwegian
is next-phase scaling — see `services/web-app/src/languages.ts`), and
`services/web-app/src/countries.ts`'s registration country dropdown was
narrowed to just Denmark/Sweden to match. That alone is not enforcement —
it only stops someone from *claiming* an unsupported country in the UI;
the backend's `createUserProfileInputSchema.country` still accepts any
2-letter code (nothing server-side validates against the same list, and
nothing stops a request that skips the dropdown entirely), and there's no
geo-restriction based on where a request actually originates.

Real enforcement needs two separate pieces:

1. **Server-side country validation** — `createUserProfileInputSchema`
   (`packages/shared/src/schemas/userProfile.ts`) should validate
   `country` against the same supported-country list `countries.ts`
   exposes, not just `.length(2)`. Straightforward; do this regardless of
   whether (2) below ever ships.
2. **IP-based geo-restriction** — block or flag requests originating
   outside the supported-language countries, independent of what a user
   *claims* their country is at registration. Needs a geo-IP lookup (a
   GCP-native option or a third-party API/database — MaxMind GeoLite2 is
   the common self-hosted choice, avoids sending IPs to another vendor).
   Where this belongs: probably `services/trpc-api`'s registration path
   (`authRouter.ts`'s `completeProfile`) or further upstream at the
   HTTPS Load Balancer/Cloud Armor level (GCP's Cloud Armor supports
   native geo-based rules — would avoid touching application code at all
   for the blocking behavior, though a friendlier in-app message on
   rejection needs app-level awareness regardless of where blocking
   itself happens).

Open question worth deciding before building either: is this a hard
block (registration fails outright) or a softer flag (allowed through,
logged/reviewed) — a hard block risks false-positives from VPNs/travel
for genuinely supported-market users; matches the general "shadow-throttle
rather than instant-ban" posture already discussed for abuse mitigation
elsewhere in the roadmap.

## Admin page: GDPR/trust & safety tooling

Discussed 2026-09-04, alongside shipping self-service "download my data"
and "delete my account" in Settings → Privacy and data. That work also
introduced an abuse-prevention ledger (`account_bans` /
`account_ban_evidence`, see `packages/shared/migrations/0001_init.ts` and
`docs/gdpr-runbook.md`) — a record, independent of a `users` row, that
survives account deletion specifically so a banned bad actor can't delete
their account and quietly re-register with the same Google account.

Today, the ban and disclosure-response logic is only exercised locally,
by hand, against the dev database (`docs/gdpr-runbook.md`) — there is no
`/manage` action that performs either in production, and there must
never be a manual, direct-database substitute for one in production,
regardless of platform scale. No one — including an account with
platform-owner access — has standing direct production database access;
the sole exception is temporary, least-privilege, audited access for a
trusted, NDA'd, employed operator performing a defined infrastructure
duty, never for acting on user content. Concretely: **a ban cannot be
created and a disclosure request cannot be answered in production until
the actions below exist.** This is a pre-launch blocker, not a someday
item.

A real admin page should eventually provide:

1. A moderator view of flagged/reported content awaiting review (there's
   currently no review queue anywhere in this codebase — see
   `sessionReportService.ts`'s own doc comment on this exact gap).
2. A "ban this account" action that writes `account_bans`/
   `account_ban_evidence` correctly (reason category + evidence snapshot
   + a written decision summary) instead of a raw manual insert, and sets
   `users.banned_at` on the live account in the same step.
3. A queue view of `data_export_requests`, especially `failed` ones
   needing attention (today there's no visibility into these beyond
   querying Postgres directly).
4. Ideally, a real moderator-identity system, so `account_bans.banned_by`
   stops being free text and a disclosure response can show who made a
   decision, not just what it was.

**Prerequisite for most of this — already satisfied, stale note removed
2026-09-10**: this used to block on there being no admin authentication/
authorization model in this codebase. That's no longer true — the
`/manage` RBAC system (roles, permissions, `hasPermission` gate in
`services/trpc-api/src/controllers/trpc.ts`/`rbacRouter.ts`, admin pages
under `services/web-app/src/pages/manage/`) shipped 2026-09-05 (see
`CHARTER.md` principle 4). Items 1-4 above can be built directly on top
of it now — nothing left to unblock first.

## Add CAPTCHA (Cloudflare Turnstile) to register/profile-completion

Discussed 2026-08-26: guard the register / profile-completion flow against
bot signups with Cloudflare Turnstile rather than reCAPTCHA — no Google
tracking cookies, fits this repo's privacy-first stance for an anonymous
user base (`docs/roadmap.md` §4.1). Not needed on login itself since that's
Google OAuth, which already filters most automated abuse.

Provisioning is Terraform-manageable via the `cloudflare/cloudflare`
provider (`cloudflare_turnstile_widget` resource), same pattern as the
existing GCP `IaC/modules/*`. Needs a new `IaC/modules/cloudflare` module
plus a Cloudflare API token as a new credential in Terraform/CI (separate
from the existing GCP service-account auth), and the resulting site
key/secret key pushed into Secret Manager the same way `AUTH_SECRET` is
today.

## Stream the GDPR data export instead of fully buffering it

Discussed 2026-09-05, while building the data-export download proxy
(`services/trpc-api/src/controllers/exportDownloadController.ts`).
`collectUserExportData` (data-export-service) aggregates a user's entire
export into one in-memory object, `JSON.stringify`s it whole, and uploads
it in one `.save()` call; the proxy route downloads it back with one
`file.download()` call that buffers the whole object into memory before
serving it. Not a real risk today — this export is plain text rows
(messages, moderation events, ratings, reports), no attachments or media
anywhere in the schema, so even a very active user tops out in the tens
of MB, not gigabytes.

Worth hardening anyway if the platform ever adds attachments/media, or
just as defense against an unexpectedly large account: paginate each
table query in `collectUserExportData` and stream rows straight into a
gzip-compressed upload rather than buffering the full object first, and
switch the download proxy from `file.download()` to
`file.createReadStream()` streamed straight through as the response body.
Removes the in-memory size ceiling entirely regardless of how large a
single account's data gets. A further step — windowing very large
categories (e.g. messages) into multiple time-chunked files inside a zip
archive rather than one flat file — is real but meaningfully more
complexity, and only worth it once there's an actual reason (media
support) to expect exports that large.
