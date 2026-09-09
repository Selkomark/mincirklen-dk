# **MINCIRKLEN — TECHNICAL SPECIFICATION**
 
Cloud Architecture, Deployment & Cost Analysis
 
*Public engineering reference — mincirklen.dk*
 
Document version: v1 — 2026-08-11
 
UI reference: https://selkomark.github.io/MinCirklen.dk/
 
*Note: this document intentionally excludes moderation model training, fine-tuning pipeline design, prompts, and detection thresholds. Those are treated as proprietary and are documented separately. This spec covers infrastructure, deployment, and the moderation service**'**s integration surface only (i.e., that a moderation call happens, not how it decides).*
 
# 1. Overview
 
MinCirklen is an anonymous, AI-moderated peer-support platform built around small, round-robin group sessions (6–12 participants). This document specifies the cloud architecture, infrastructure-as-code approach, and cost model for a Claude Code build session. It assumes the product/safety principles defined in the project roadmap (non-negotiable safety architecture, deterministic crisis escalation, anonymity by default) as fixed constraints on the technical design.
 
# 2. System Overview
 
Core interaction pattern: users join a room (a "circle") of 6–12 people. Turns are taken in strict round-robin order with bounded engage and typing windows (see Appendix C of the roadmap for exact timings). Every message is checked by a moderation service before being broadcast to the group. Crisis-flagged content always triggers a deterministic escalation path, independent of the moderation service's internal judgment.
 
# 3. High-Level Architecture
 
Components:
 
- Client: browser/mobile app, holds one persistent WebSocket connection to the platform for as long as the user is signed in and on a gated page — not opened and closed per circle — telling the server what it currently wants to watch (a specific circle, or a set of circles being browsed), plus REST/RPC calls for auth, history, and account actions.
 
- Load Balancer: Google-managed HTTPS Load Balancer, terminates TLS, handles WebSocket upgrade, and applies session affinity so a reconnecting client is routed back to a consistent backend where useful.
 
- tRPC API (Cloud Run): stateless request/response service — auth, session/room management, history retrieval, and incoming message ingestion. Every message a user sends is submitted here first. Open-source. Scales to zero between bursts.
 
- WebSocket Service (GKE Autopilot): handles live, real-time delivery only — pushing round-robin turn state, matchmaking updates, and already-approved messages out to connected clients. It does not ingest or classify incoming messages. Stateless at the pod level — any pod can serve any connected user.
 
- NATS (GKE Autopilot, core pub/sub — no JetStream/replay): fanout layer, internal to the WebSocket service only. Since a room's participants can be connected to different WebSocket pods, NATS pub/sub relays a message published by one pod to all pods, so every participant receives it regardless of which pod they're attached to. Carries both chat-message and presence (roster/turn/join/live-count) events, on separate subjects. Nothing outside the WebSocket service ever connects to NATS directly.
 
- Moderation Service (Cloud Run, private subnet): a separate, independently deployed service, called by the tRPC API over gRPC for every inbound message before it's persisted or released. Returns a pass/flag/crisis classification. Internal detection logic and model details are out of scope for this document (proprietary, documented separately).
 
- Redis: the WebSocket service's own shared memory, internal to it — live round/roster/presence state (whose turn it is, room membership, who's currently online) across its own pods. Seeded from Cloud SQL the first time a session's state is touched, then authoritative until the process restarts. Neither the tRPC API nor the web-app ever accesses Redis directly; a caller that needs this state asks the WebSocket service's internal HTTP surface for it.
 
- Cloud SQL (Postgres, shared): durable storage for chat history, session metadata, feedback ratings, and moderation transparency metrics. Accessed independently by the tRPC API and the WebSocket service — the web-app never reaches it directly, only through those two services' APIs.
 
- Secret Manager: holds service credentials and the moderation service's configuration reference. (What that reference points to, and how it's produced, is out of scope here.)
 
## 3.1 Overview diagram
 
# 4. Data Flow — A Single Message
 
- 1. User's turn is active (round-robin state held in the WebSocket service's Redis, read via its internal HTTP surface — never directly by the tRPC API); client sends the message over HTTPS to the tRPC API (trpc.mincirklen.dk), not directly to the WebSocket service.
 
- 2. The tRPC API calls the Moderation Service over gRPC (private subnet) with the message, and waits for a pass/flag/crisis classification before doing anything else with it.
 
- 3. If "pass": the tRPC API persists the message to Cloud SQL, then calls the WebSocket service's internal HTTP surface twice — once to hand the approved message off for live delivery, once to advance round state. The receiving WS pod does the corresponding Redis update itself and publishes the result to the room's NATS subjects (message and presence); every WS pod with a member of that room subscribed receives it and pushes it to its locally connected clients.
 
- 4. If "flag" (non-crisis, e.g. solicitation/toxicity pattern): the message is held back from the room by the tRPC API, logged for human review, and the sender may be rate-limited or shadow-throttled per the roadmap's threat-model rules. It is never handed to the WebSocket layer for delivery.
 
- 5. If "crisis": the tRPC API triggers the deterministic escalation path immediately — resource card to the user, alert to the on-call human moderator — independent of any other classification detail, before any further processing of that message.
 
# 5. Cloud Component Summary
 
| **Component** | **Platform** | **Role** | **Scaling model** |
| --- | --- | --- | --- |
| tRPC API | Cloud Run | Auth, session mgmt, message ingestion, REST/RPC | Scale-to-zero, per-request |
| WebSocket service | GKE Autopilot | Live delivery, round state, presence/live-count | Horizontal, pod-level, spot-eligible |
| NATS (core pub/sub) | GKE Autopilot | Cross-pod message + presence fanout, internal to the WebSocket service | Small fixed cluster, non-spot |
| Moderation service | Cloud Run (private) | Per-message classification via gRPC | Scale-to-zero, per-request |
| Redis | GKE Autopilot (self-hosted) or Memorystore | WebSocket service's own shared round/roster/presence state — not reached by tRPC or web-app | Small, non-spot, AOF persistence |
| Cloud SQL (Postgres) | Managed | Shared chat history, metadata, metrics (tRPC + WS) | Vertical, smallest viable tier at MVP |
| Load Balancer | Managed | TLS, WS upgrade, routing | Managed, no scaling config needed |
 
# 6. Network Architecture
 
The domain mincirklen.dk is managed in Cloud DNS. Network layout separates public-facing surface area from internal-only services, so the moderation system is not reachable via public DNS at all.
 
## 6.1 Public surface
 
- Cloud DNS zone for mincirklen.dk hosts the following public subdomains, each pointed at the Load Balancer's static IP (A/AAAA records), with a managed SSL certificate covering all three:
 
- mincirklen.dk — the web-app (static/SPA frontend).
 
- trpc.mincirklen.dk — the tRPC API (Cloud Run).
 
- socket.mincirklen.dk — the WebSocket service (GKE Autopilot).
 
- The Load Balancer is the single public entry point across all three subdomains. Host-based routing directs trpc.mincirklen.dk to the tRPC API via a serverless NEG (Cloud Run), socket.mincirklen.dk to the WebSocket service via a container-native NEG (GKE), and mincirklen.dk to the web-app's static hosting backend.
 
- The tRPC API and WebSocket service are exposed only through their respective subdomains via the Load Balancer — neither has a direct public IP or public Cloud Run URL enabled outside that path (ingress restricted to "internal and load balancing" on the Cloud Run side).
 
## 6.2 Private network
 
- The moderation service and the fine-tuning/training system run in a private subnet with no public IP addressing and no public DNS entry. They are not reachable from the internet under any path.
 
- The tRPC API is the only caller of the moderation service. It reaches it over internal networking only, via gRPC, using a Serverless VPC Access connector (Cloud Run-to-Cloud Run, private ingress). No public DNS name is ever created for the moderation service.
 
- Cloud NAT provides egress for the private subnet (e.g. outbound calls to an external model API) without assigning any inbound-reachable public IP to the services inside it.
 
- Secret Manager access and the Cloud SQL instance are reached over the private network / VPC peering, accessible to both the tRPC API and the WebSocket service; Redis is reached the same way but only by the WebSocket service, which is the only thing that ever connects to it. None of them have public endpoints.
 
## 6.3 Subnet summary
 
| **Subnet** | **Contains** | **Public DNS / ingress** |
| --- | --- | --- |
| Public subnet | WebSocket service (GKE), Load Balancer NEGs | Yes — socket.mincirklen.dk via the Load Balancer |
| Private subnet | Moderation service, fine-tuning/training system | No — internal-only, no public DNS entry |
| Cloud Run (API) | tRPC API | Yes — trpc.mincirklen.dk via Load Balancer only; direct Cloud Run URL ingress restricted |
| Web-app hosting | Static/SPA frontend | Yes — mincirklen.dk (root domain) via the Load Balancer |
| Shared data layer | Cloud SQL — reachable independently by the tRPC API and WebSocket service; Redis — reachable only by the WebSocket service | No — private network / VPC peering only |
 
# 7. Infrastructure as Code — Terraform
 
All cloud resources are provisioned via Terraform, not manual console setup, so environments (dev/staging/prod) stay reproducible and reviewable.
 
## 7.1 Repository layout
 
- IaC/modules/gke-autopilot — cluster definition, node pool defaults (spot toggle per workload via node selector), workload identity.
 
- IaC/modules/cloud-run — reusable module for both the tRPC API and moderation services (image, env vars, min/max instances, ingress settings).
 
- IaC/modules/cloud-sql — Postgres instance, database, user, private IP / VPC peering config.
 
- IaC/modules/redis — either a Memorystore module or a Kubernetes-manifest-based module (StatefulSet + PVC) depending on the chosen hosting approach.
 
- IaC/modules/networking — VPC, public and private subnets, Cloud NAT, Serverless VPC Access connector, firewall rules, Cloud DNS zone, the HTTPS Load Balancer and managed SSL certificate.
 
- IaC/modules/secrets — Secret Manager resources and IAM bindings (references only; secret values are not stored in Terraform state).
 
- IaC/environments/dev, /staging, /prod — thin root modules that call the shared modules above with environment-specific variables (instance sizes, spot on/off, replica counts).
 
## 7.2 State management
 
- Remote state in a GCS bucket, one state file per environment, with state locking enabled.
 
- Service account for Terraform with least-privilege IAM roles scoped to the resources it manages, not project-owner.
 
## 7.3 Repository and pipeline structure
 
The project is split across multiple repositories/pipelines, each independently deployable, but with an explicit ordering dependency: infrastructure must exist and succeed before any application service deploys into it.
 
- IaC — its own GitHub Actions pipeline. Owns all Terraform: networking, GKE Autopilot cluster, Cloud Run service shells, Cloud SQL, Redis, DNS, Load Balancer.
 
- web-app (tRPC API + WebSocket service) — its own GitHub Actions pipeline. Deploys application code/images into the Cloud Run and GKE resources that IaC already provisioned.
 
- moderation-service — its own GitHub Actions pipeline. Deploys the moderation service's application image into the private-subnet Cloud Run service that IaC already provisioned. (Model training/fine-tuning pipeline is a separate, proprietary repository, out of scope for this document.)
 
## 7.4 Release and ordering model
 
Deployments are triggered by GitHub tag releases prefixed prod- (e.g. prod-2026.08.20-1) rather than plain branch pushes, so a production deployment is always an explicit, reviewable, tagged event across every repo.
 
- A release is cut by tagging the commit in each relevant repository with the same prod- tag (or a shared release identifier embedded in the tag), so infra and application changes for a given release are traceable to one coordinated change set.
 
- The IaC pipeline runs first on a matching prod- tag: terraform plan, manual approval gate, then terraform apply. The pipeline only reports success once apply completes cleanly.
 
- The web-app and moderation-service pipelines are gated on the IaC pipeline's success for the corresponding release — implemented as a workflow dependency (e.g. a GitHub Actions "workflow_run" trigger watching the IaC repo/workflow, or a status check the downstream pipelines poll/require) before their own build-and-deploy steps run.
 
- If the IaC apply fails or is not yet complete for a given prod- tag, the web-app and moderation-service pipelines must not proceed to deploy — they should fail fast or wait, never deploy application code against infrastructure that isn't confirmed up to date.
 
- Within a single release, web-app and moderation-service pipelines are otherwise independent of each other and can deploy in parallel once IaC has succeeded — neither depends on the other's deployment completing.
 
## 7.5 Environments
 
- dev — minimal sizing, spot enabled everywhere it's safe (WS pods only), used for integration testing. Deployed on ordinary branch/PR triggers, not the prod- tag flow.
 
- staging — mirrors prod topology at smaller scale, used for pre-release verification and pilot data collection.
 
- prod — sized per the cost analysis below, spot enabled only for WebSocket pods, deployed exclusively via the prod- tag release flow described above.
 
# 8. Cost Analysis
 
Based on the platform's actual traffic pattern: round-robin turn-taking means each participant sends roughly one message per 5–60 seconds while active, not a continuously chatty stream. This keeps connection-layer costs low; the primary variable cost is the per-message moderation call, which is outside the scope of this document.
 
## 8.1 Small pilot scale (a few hundred concurrent users)
 
| **Component** | **Without spot** | **With spot (WS pods only)** |
| --- | --- | --- |
| WebSocket pods (GKE Autopilot) | $15–30 | $5–12 |
| NATS (3-node cluster) | $20–35 | $20–35 (non-spot) |
| Redis (self-hosted, AOF) | $15–35 | $15–35 (non-spot) |
| tRPC API (Cloud Run) | $10–30 | $10–30 |
| Cloud SQL (Postgres, small tier) | $25–50 | $25–50 |
| Load Balancer + egress | $10–20 | $10–20 |
| Total (infra only) | $95–200 / month | $85–182 / month |
 
## 8.2 Scaled estimate (~2,000 concurrent users)
 
At 2,000 concurrent users, average group size 6–12 (≈220 concurrent circles), throughput per group stays low due to round-robin pacing, but connection count and state volume both scale linearly with users.
 
| **Component** | **Without spot** | **With spot (WS pods only)** |
| --- | --- | --- |
| WebSocket pods (GKE Autopilot) | $40–70 | $15–25 |
| NATS (3-node cluster, upsized) | $40–70 | $40–70 (non-spot) |
| Redis (HA tier or self-hosted Sentinel) | $40–150 depending on approach | same (non-spot) |
| tRPC API (Cloud Run) | $40–80 | $40–80 |
| Cloud SQL (Postgres, upsized) | $80–120 | $80–120 |
| Load Balancer + egress | $20–40 | $20–40 |
| Total (infra only) | $260–530 / month | $235–505 / month |
 
## 8.3 Notes on cost drivers
 
- Spot pricing only meaningfully reduces WebSocket pod cost — NATS, Redis, and Cloud SQL should not run on spot capacity, since their state (cluster membership, matchmaking state, durable data) is safety- and correctness-critical.
 
- Self-hosting Redis on standard GKE Autopilot pods (with AOF persistence and Sentinel for failover) is materially cheaper than Memorystore's HA tier at scale, at the cost of owning failover operations directly.
 
- Per-message moderation cost (the LLM API call) is not included in the tables above — it scales with message volume rather than connection count, and is documented separately since it touches proprietary model details.
 
- These are infrastructure estimates for planning purposes; validate against the GCP Pricing Calculator with real traffic data once pilot metrics exist (see roadmap Section 6).
 
# 9. Non-Functional Requirements Carried Over From the Roadmap
 
- Anonymity by default — no user directory, no cross-session lookup, no public profiles. This constrains schema design (no globally unique, human-searchable identifiers exposed via any API).
 
- Deterministic crisis escalation — the escalation code path must be simple enough to audit independently of the moderation service, and must have no conditional bypass anywhere in the call chain.
 
- Equity in expression — access/pricing tiers gate session count only, never per-turn time, typing window, or message length. This must be enforced at the session-count layer, not anywhere in the round-pacing logic.
 
- Data minimization — aggressive retention limits on session transcripts, encryption at rest and in transit, and a design where the operator cannot casually re-identify a user from stored data.
 
# 10. Coding Principles & Engineering Standards
 
These apply across all services (tRPC API, WebSocket service, web-app) unless a component-specific note says otherwise. They're standards for Claude Code (or any engineer) to follow when implementing against this spec, not aspirational guidance.
 
- DRY (Don't Repeat Yourself) — shared logic (validation, types, room/round-state helpers) lives in a single shared module/package consumed by every service that needs it, not duplicated per-service.
 
- KISS (Keep It Simple) — prefer the straightforward implementation over a clever or maximally general one; complexity is justified by a concrete, current requirement, not by anticipated future needs.
 
- Functional style — pure functions wherever practical (same input, same output, no hidden side effects), immutability by default (avoid in-place mutation of shared state; construct new values instead), and composition over inheritance (build behavior by combining small functions/modules rather than deep class hierarchies).
 
## 10.1 Web-app specifics
 
- SPA — the web-app is built as a single-page application for in-session navigation and interactivity once loaded (round-robin UI, live state updates, matchmaking flows).
 
- SSR — initial page loads are server-side rendered, so first paint (landing page, public manifesto page, etc.) doesn't depend on client-side JS execution first. This matters for SEO on public pages and for fast, low-friction entry for users arriving from a link, not just for the in-session experience.

## 10.2 Backend service specifics

The enforced architecture standard for every backend service (tRPC API, WebSocket service, moderation service) lives in `ARCHITECTURE.md` at the repo root — this subsection is a pointer, not a duplicate. In summary:

- Framework: Hono, on Bun, for all three services. The tRPC API mounts its tRPC router onto Hono via `@hono/trpc-server` rather than tRPC's standalone HTTP adapter.
- Data access: Kysely is the only way any service talks to Postgres — this supersedes any earlier assumption of raw `pg.Pool` queries. Migrations are Kysely-native TypeScript files, not hand-rolled SQL plus a custom runner.
- Layering: Clean Architecture, unidirectional `Controller → Service → Repository/Adapter` — dependencies point one way only, and a Service never imports a framework type.
- Testing: TDD (tests before implementation), a 100% line/function coverage target enforced via `bun test --coverage`, mocking only at the Adapter/Repository boundary, and idempotent seeding for anything that hits real infrastructure. See `ARCHITECTURE.md` for the full detail, including where and why the enforced coverage floor currently sits below 100% for two specifically reviewed files.

# 11. Open Questions for Pilot Data
 
- Actual message volume per session (affects moderation service sizing and cost, tracked separately).
 
- Real distribution of engage-window response times and typing durations (affects Redis/state sizing assumptions).
 
- Whether Memorystore HA or self-hosted Redis Sentinel is the better tradeoff once real failure-rate tolerance is understood from pilot operations.
 
- Right-sizing of Cloud SQL and NATS once real concurrent-room counts and message rates are measured.
