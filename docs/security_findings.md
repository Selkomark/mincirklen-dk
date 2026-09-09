# Security findings — full-stack review

> **Status: pre-release audit reference (incomplete draft).** This document
> is a scaffold started with a separate model and is intentionally kept as a
> reference to complete during the formal pre-release security audit — it is
> **not** the active working findings list. The current, complete findings
> being worked from now live in [`SECURITY_FINDINGS.md`](../SECURITY_FINDINGS.md)
> at the repo root. Flesh this document out (its status-convention and
> severity model below are the intended format for the audit) rather than
> treating its single partial entry as the full picture.

**Date:** 2026-08-26
**Scope:** `services/trpc-api`, `services/websocket-service`,
`services/moderation-service`, `services/web-app`, `packages/shared`,
`docker-compose.yml`, `local-infra/caddy/Caddyfile`.
**Status convention:** every finding starts `OPEN`. When a finding is
fixed, change it to `FIXED (<commit>)`; if consciously accepted instead,
change it to `ACCEPTED` with a one-line rationale. Do not delete entries.
**Purpose:** reference document for remediation work. Findings are
*flagged only* — nothing in this document has been fixed. Read the
"Deliberate dev-environment posture" and "Reviewed and found sound"
sections before fixing anything, so accepted local-dev trade-offs and
already-correct code don't get churned.

Severity: **HIGH** = fix before any real user data exists; **MEDIUM** =
fix before public launch; **LOW** = hardening / defense-in-depth;
**INFO** = track, no action forced.

---

## Authentication & session management

### SEC-001 — No rate limiting or abuse controls on any endpoint — HIGH — OPEN

Nothing in `trpc-api` is rate-limited. Concretely exploitable today