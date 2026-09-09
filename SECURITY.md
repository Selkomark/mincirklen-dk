# Security

This is the source of truth for this repo's security configuration —
GitHub repo/org settings, branch protection, CI/CD trust boundaries, and
the supply-chain posture for GitHub Actions and dependencies. If a setting
listed here changes in GitHub, update this file in the same change — see
`.claude/skills/security-guard`, which exists specifically to keep the two
in sync and to vet new external sources before they're added anywhere.

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/Selkomark/MinCirklen.dk/security/advisories/new)
(Security tab → "Report a vulnerability") — enabled on this repo. Don't
open a public issue for a security problem.

## Repository access

- Public repo, forking enabled — anyone can fork and open a PR.
- Write access (repo membership) is employee-only, gated by NDA and signed
  contract. No exceptions for external contributors based on contribution
  history — see the fork PR approval setting below for why that
  distinction matters.
- Current collaborators: `@blackavec` (admin)

## Branch protection — `main`

- Pull request required before merging
- 1 approving review required
- Review required from Code Owners (see `.github/CODEOWNERS`)
- Stale reviews dismissed on new pushes
- Conversation resolution required before merge
- Force pushes disabled
- Branch deletion disabled
- Merged PR branches auto-delete
- Admins can bypass (`enforce_admins: false`) — intentional: the sole
  maintainer needs to keep shipping solo without a second reviewer.
  External contributors are never admins, so this bypass never applies to
  them.

## CODEOWNERS

`* @blackavec` — every file requires the repo owner's review. Split this
by area if/when trusted employees are added as collaborators.

## GitHub Actions

### Fork PR workflow approval

**"Require approval for all external contributors."** Every workflow run
triggered by a PR from a non-member, non-owner, non-Selkomark-org account
requires a maintainer to manually click "Approve and run" — every time,
with no exemption based on contribution history.

Deliberately *not* "require approval for first-time contributors": that
setting permanently exempts a contributor after their first merged PR — a
bad actor could land one trivial PR to earn trust, then submit a malicious
one that runs unattended against real CI credentials.

### Workflow permissions

- Default `GITHUB_TOKEN`: read-only (`contents` + `packages` scopes only)
- Actions cannot create or approve pull requests

### Actions allowlist (supply-chain hardening)

`allowed_actions: selected` — only actions from these sources may be
referenced in any workflow:

- `actions/*` (GitHub-owned, via `github_owned_allowed: true`)
- `google-github-actions/*`
- `hashicorp/*`
- `oven-sh/*`

`verified_allowed: false` — deliberately not relying on GitHub's "verified
creator" badge (identity verification, not a security review) as a trust
signal. Every allowed source is explicit.

**Adding a new source** (an action from an org not in this list) requires
all four of:

1. Evaluating the source — see `.claude/skills/security-guard`
2. Adding its org pattern to `patterns_allowed`:
   `gh api --method PUT repos/Selkomark/MinCirklen.dk/actions/permissions/selected-actions --input -`
   (merge with the existing list — don't drop what's already there)
3. Adding it to the allowlist above in this file
4. Pinning every reference to it by full commit SHA (below)

### Required SHA pinning

`sha_pinning_required: true` at the repo level — every `uses:` in every
workflow must reference a full-length commit SHA, never a mutable tag
(`@v4`) or branch. A tag can be moved by the upstream maintainer (or by
whoever compromises their account); a commit SHA can't.

Convention: `uses: org/action@<40-char-sha> # v4` — the trailing comment
is for humans only, GitHub doesn't resolve it.

Currently pinned (re-derive with `grep -rn "uses:" .github/workflows/*.yml`
if this drifts — the workflow files are the source of truth, this table is
a convenience summary):

| Action                        | Pinned SHA                              | Version |
| ------------------------------ | ---------------------------------------- | ------- |
| actions/checkout               | 11d5960a326750d5838078e36cf38b85af677262 | v4      |
| actions/configure-pages        | 983d7736d9b0ae728b81ab479565c72886d7745b | v5      |
| actions/deploy-pages           | d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e | v4      |
| actions/download-artifact      | d3f86a106a0bac45b974a628896c90dbdf5c8093 | v4      |
| actions/github-script          | f28e40c7f34bde8b3046d885e986cb6290c5673b | v7      |
| actions/upload-artifact        | ea165f8d65b6e75b540449e92b4886f43607fa02 | v4      |
| actions/upload-pages-artifact  | fc324d3547104276b827a68afc52ff2a11cc49c9 | v5      |
| google-github-actions/auth     | c200f3691d83b41bf9bbd8638997a462592937ed | v2      |
| hashicorp/setup-terraform      | b9cd54a3c349d3f38e8881555d616ced269862dd | v3      |
| oven-sh/setup-bun              | 0c5077e51419868618aeaa5fe8019c62421857d6 | v2      |

## Secrets and credentials

- No `secrets.*` are referenced in any workflow — only `vars.*`
  (non-secret identifiers: WIF provider path, service account email, GCP
  project ID, state bucket name).
- GCP authentication uses Workload Identity Federation (OIDC) — no static
  service account keys, ever, anywhere in this repo or its CI.
- Cloud SQL uses IAM database authentication — no database passwords are
  ever created or stored (`IaC/modules/cloud-sql`).
- Secret Manager (`IaC/modules/secrets`) creates secret *containers* and
  IAM bindings only. Actual secret values never pass through Terraform (so
  they never land in state) — they're added out-of-band via
  `gcloud secrets versions add`.
- Local dev (`docker-compose.yml`) uses a throwaway Postgres password
  (`mincirklen`/`mincirklen`) — not a real credential. Note it's *not*
  restricted to `127.0.0.1`: like most services in the stack (Redis, NATS,
  trpc-api, websocket-service, web-app, Caddy, and now `dns`), it publishes
  on all interfaces, so it's reachable by anything on the same LAN as the
  developer's machine — acceptable given the throwaway credential and the
  local-only nature of the data, but not literally "never reachable outside
  a developer's own machine."

## Repository security features

- Secret scanning: enabled
- Secret scanning push protection: enabled (blocks pushes containing
  detectable secrets before they land)
- Private vulnerability reporting: enabled
- Dependabot security updates: enabled
- Not yet enabled — GitHub Advanced Security features, evaluate if/when
  needed: `secret_scanning_non_provider_patterns`,
  `secret_scanning_ai_detection`, `secret_scanning_validity_checks`

## Production deployment gate

- `iac-apply.yml` — the only workflow that can mutate real infrastructure
  — triggers exclusively on a `prod-*` tag push (external contributors
  can't push tags to this repo) and additionally requires manual approval
  from the `production` GitHub Environment's required reviewers
  (currently: `@blackavec`).
- `iac-plan.yml` runs `terraform plan` (read-only) on PRs touching
  `IaC/**`, gated by the fork PR approval setting above.

## Planned: private-repo deploy split

See `TODO.md` — `iac-apply.yml`/`iac-plan.yml` are planned to move to a
private companion repo before going live, since GitHub ties Actions
visibility to repo visibility and there's no way to hide CI logs on a
public repo otherwise.

## Local development

See `docs/local_dev.md`. The local Docker Compose stack, DNS, and TLS
setup are self-contained to this repo (no dependency on or interference
with any other project) and have no bearing on production security — none
of it touches GCP/Terraform/GitHub Actions credentials. It is *not*,
however, strictly offline/loopback-only — see above and below.

### Data-store admin UIs (`adminer`, `redisinsight`, `nats-nui`)

`docker-compose.yml` includes dev-only web UIs for inspecting the local
Postgres, Redis, and NATS containers — reached via Caddy at
`pg.dev-mincirklen.dk`, `redis.dev-mincirklen.dk`, and
`nats.dev-mincirklen.dk` respectively (the existing wildcard cert and
wildcard `dnsmasq` answer already cover them; no DNS/cert changes needed).
None are published to a host port directly — only reachable through Caddy,
same as `trpc.dev-mincirklen.dk`/`socket.dev-mincirklen.dk`. All three are
pinned by digest rather than a mutable tag, same convention as `vpn` below.

- **`adminer`**: Docker Official Image (`docker.io/library/adminer`,
  4-standalone / 4.17.1) — highest trust tier available for a Docker Hub
  image.
- **`redis/redisinsight`** (2.70): official image from Redis Ltd.
  (verified publisher), the vendor's own Redis client.
- **`ghcr.io/nats-nui/nui`** (0.9.3): community project, not an
  official-images-library or verified-publisher image — vetted per
  `.claude/skills/security-guard`: actively maintained (releases roughly
  every 1-2 months, latest a few weeks old as of writing), MIT licensed,
  modest but real adoption (~150 GitHub stars). Same trust tier as
  `wg-easy/wg-easy` below.
- **No auth of their own**: like every other service in this stack, these
  three have no login screen — reachability is gated only by network
  access to the developer's machine/LAN, not by an application-level
  credential. Acceptable under the same reasoning as the rest of local dev
  (throwaway data, local-only), but worth knowing before pointing one at
  anything that isn't throwaway.

### Local KMS emulator (`vault`, `vault-init`)

`docker-compose.yml` runs a real (non-dev) HashiCorp Vault server, standing
in for a real cloud KMS (e.g. GCP Cloud KMS in production) so `trpc-api`
can encrypt PII fields (`user_profiles.pii_ciphertext`) through the same
encrypt/decrypt adapter interface locally as it would in prod, rather than
holding a raw symmetric key in an env var. `vault-init` is a one-shot
container that initializes Vault the first time it ever runs, unsealing
it and ensuring the Transit engine/key and the fixed dev app token exist
on every `docker compose up` after that; `trpc-api` depends on `vault-init`
completing successfully before it starts.

- **Image trust**: `hashicorp/vault` — HashiCorp's own verified-publisher
  image on Docker Hub, not a third party. `hashicorp/*` is already an
  allowlisted org elsewhere in this repo (the GitHub Actions allowlist
  above, and `hashicorp/setup-terraform` already pinned there), so this
  isn't a new vendor being trusted for the first time. Pinned by digest
  (`1.18` /
  `sha256:750bb37c1638fa194ab37053a81618c61bb0491ddec6fccac87c07a8e6cd8166`),
  same convention as `adminer`/`redisinsight`/`nats-nui`/`vpn` below.
- **Persistent, not dev mode**: runs `vault server` with file storage
  (`local-infra/vault/vault-config.hcl`, backed by the
  `mincirklen-vault-data` volume) instead of `-dev`'s in-memory storage —
  the Transit key survives `docker compose down`/`up` and container
  restarts, same as postgres/redis/nats already do. This matters: a
  from-scratch Transit key on every restart while Postgres data persisted
  across the same restart used to mean any existing `user_profiles` row
  became silently undecryptable — see `oauthController.ts` and
  `authRouter.ts`'s `myProfile` for the app-side fix (login/gating never
  depend on decrypt succeeding) and this section for the storage-side one.
  Single Shamir key share (`-key-shares=1 -key-threshold=1`) — dev
  convenience, not real Shamir security; never mirror that choice in
  production. `vault-init` persists the generated unseal key and root
  token to the separate `mincirklen-vault-init-data` volume (used only to
  re-unseal on each restart) — a local Docker volume, never committed to
  the repo, but still a real secret's worth of trust: don't reuse it or
  its contents outside this dev stack.
- **Network exposure**: published to the host on `8200`, like
  `postgres`/`redis`/`nats` (not routed through Caddy, and not restricted
  to `127.0.0.1` — same LAN-reachable posture as those), specifically so
  integration tests running via `bun test` on the host can reach it
  directly, the same way they reach the local Postgres. Acceptable under
  the same reasoning as those: throwaway dev token, no real secret behind
  it despite now being persistent.
- **Dev app token**: `dev-only-not-for-production` (matches the existing
  `AUTH_SECRET` dev value) — a throwaway local credential, not a real
  secret, consistent with the Postgres password note above. Created once,
  on Vault's very first init, with a fixed ID (`vault token create
  -id=dev-only-not-for-production -policy=root -orphan`) specifically so
  `trpc-api`/`websocket-service`'s `VAULT_TOKEN` env var never has to
  change across a fresh init.

### Error/log tracking (`glitchtip`, `glitchtip-redis`, `glitchtip-db-init`, `glitchtip-init`)

`docker-compose.yml` runs a self-hosted [GlitchTip](https://glitchtip.com/)
instance — an open-source, MIT-licensed, Sentry-SDK-compatible error/log/
performance tracker. Chosen specifically to avoid Sentry SaaS's per-seat/
per-event pricing while staying wire-compatible with the `@sentry/*` SDKs.
One project per service, all under the same org (`local-infra/glitchtip/init.py`):
`web-app` (browser, `@sentry/react`, reached via Caddy at
`glitchtip.dev-mincirklen.dk` — see `.agents/skills/dev-domains/SKILL.md`),
and `trpc-api`/`websocket-service`/`moderation-service` (`@sentry/bun` +
`@sentry/hono`, reached container-to-container over plain HTTP at
`glitchtip:8000` — the mkcert CA behind the public HTTPS domain is only
trusted by the host/browser, not by any container, so a backend SDK using
the public domain fails TLS verification; see `init.py`'s own comment). A
production deployment on the same GKE Autopilot cluster used for
`websocket-service` is planned (`IaC/`) but not yet built.

- **Image trust**: `glitchtip/glitchtip` (tag `6`) — the project's own
  official image, published under their own Docker Hub org, matching
  exactly what their own install docs
  (`https://glitchtip.com/assets/compose.sample.yml`) reference. Not a
  Docker-Official-Images-library or verified-publisher image, but a real,
  actively maintained project (GlitchTip 6 shipped February 2026, MIT
  license, genuine adoption) — vetted per
  `.claude/skills/security-guard`, same trust tier as `nats-nui` above.
  Pinned by digest
  (`sha256:a3d8eb1b36c1e1603d55ab32711ea3dd8115874742a781a57391a62a16e0dff6`),
  same convention as the other pinned images in this file.
- **Data**: its own database inside the shared `postgres` container
  (created once by the one-shot `glitchtip-db-init`, idempotent — same
  "create if missing" shape as `vault-init` below, just for a database
  instead of a Vault token) rather than a second Postgres container — pure
  cost/footprint reuse, mirrors the plan for the real Cloud SQL instance
  in prod. Its own dedicated `glitchtip-redis` (no volume — Celery
  broker/cache data is disposable), deliberately **not** sharing the app's
  own `redis` above, which is correctness-critical live turn/roster/
  presence state that shouldn't take on unrelated queue traffic.
- **No auth of their own to reach the network path** (same as the
  data-store admin UIs above) — GlitchTip has its own login/signup
  screen once you reach it, but nothing gates reaching that screen beyond
  network access to the developer's machine/LAN. Acceptable under the
  same throwaway-local-data reasoning as the rest of this stack.
- **Secrets**: `SECRET_KEY: dev-only-not-for-production` — a throwaway
  local value, same convention as `AUTH_SECRET`/`VAULT_TOKEN` elsewhere in
  this file, not a real secret.
- **`glitchtip-init`**: one-shot service (`local-infra/glitchtip/init.py`,
  run via `manage.py shell`) that scripts the manual signup/org/team/
  project/DSN-copy flow GlitchTip's own getting-started UI otherwise
  requires by hand — idempotent (`get_or_create` throughout), same
  "safe on every `docker compose up`" shape as `vault-init`. Creates a
  superuser at `GLITCHTIP_INIT_EMAIL`/`GLITCHTIP_INIT_PASSWORD`
  (`admin@dev-mincirklen.dk` / `dev-only-not-for-production-1`) — same
  throwaway-local-credential posture as `SECRET_KEY` above.

### Optional VPN (`vpn` service)

`docker-compose.yml` includes an optional, profile-gated WireGuard service
(`ghcr.io/wg-easy/wg-easy`, pinned by digest) so a developer can reach
`dev-mincirklen.dk` from a phone or laptop off their LAN. It never starts
via a plain `docker compose up -d`/`down` — only via explicit
`docker compose up -d vpn` or `./setup-local-vpn.sh`. See `docs/vpn_local_dev.md`
for full setup instructions, including a gotcha in the admin UI that can
silently break it (an easy mistake to make, not a security issue, but
worth knowing about before you hit it).

- **Image trust**: `wg-easy/wg-easy` is a widely-used (26k+ GitHub stars),
  actively-maintained community project — the de-facto standard WireGuard
  container with a web admin UI. Not a Docker Hub "official" image (same
  as `strm/dnsmasq`, already used for `dns`), but vetted per
  `.claude/skills/security-guard` and pinned by digest rather than a
  mutable tag.
- **New network exposure**: enabling this requires forwarding a UDP port
  on the developer's home router to their machine, and widening `dns` from
  `127.0.0.1`-only to all interfaces so a tunneled client can resolve
  `dev-mincirklen.dk`. The forwarded port only accepts WireGuard's
  cryptographic handshake — a peer needs a provisioned key (via the admin
  UI, not guessable) to get anywhere; an open UDP port alone grants no
  access.
- **Admin UI**: wg-easy v15 has no environment-variable setup — the admin
  account is created through a one-time web setup wizard on first visit
  (`http://<LAN-IP>:51821/setup/1`). No secret material for this service
  ever lands in this repo.
- This is entirely opt-in, per-developer, home-network infrastructure. It
  has no bearing on production security or CI/CD.
