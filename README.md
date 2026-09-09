# MinCirklen

MinCirklen is an anonymous, AI-moderated peer-support platform. No
profiles, no directory, no way to look anyone up — just small, moderated
circles to be heard in.

## Documentation

- [docs/local_dev.md](docs/local_dev.md) — running the full stack locally
  (one-time DNS/HTTPS setup, daily use, live reload, teardown)
- [docs/vpn_local_dev.md](docs/vpn_local_dev.md) — optional VPN setup for
  reaching local dev from a phone/laptop off your LAN
- [docs/security_findings.md](docs/security_findings.md) — pre-release
  security audit reference (incomplete draft; active findings live in
  `SECURITY_FINDINGS.md`)
- [docs/gdpr-runbook.md](docs/gdpr-runbook.md) — manual operator
  procedures for the abuse-prevention ban ledger and post-deletion
  data-disclosure requests
- [REJECTED_IDEAS.md](REJECTED_IDEAS.md) / [PROMISING_IDEAS.md](PROMISING_IDEAS.md) —
  product/feature ideas evaluated against `CHARTER.md`, with why
- [docs/executive_blueprint.md](docs/executive_blueprint.md) —
  the actual AI tooling this project is built with

## Project layout

```
services/
  web-app/              React web app (design system + SSR frontend)
  trpc-api/             tRPC API (Cloud Run in prod)
  websocket-service/     WebSocket service (GKE Autopilot in prod)
  moderation-service/     AI moderation (Cloud Run in prod, never public)
  data-export-service/    GDPR "download my data" worker (Cloud Run in
                           prod, never public — triggered by Pub/Sub, see
                           docs/gdpr-runbook.md)
IaC/                    Terraform for all cloud infrastructure
local-infra/            Config for the local dev stack (Caddy, dnsmasq)
docs/                   Deeper docs — see Documentation above
```

## Running it locally

Full instructions, including one-time DNS/HTTPS setup and the live-reload
model, are in **[docs/local_dev.md](docs/local_dev.md)**. Short version:

```
./setup-local-dns.sh      # one-time per machine
./setup-local-certs.sh    # one-time per machine
docker compose up -d --build
```

Then visit `https://dev-mincirklen.dk`.

If Caddy crash-loops with `permission denied` reading the key file (usually
from `setup-local-certs.sh` having been run with `sudo` by mistake at some
point), fix just the file ownership/permissions — isolated from the rest of
the script, so it won't regenerate certs or touch mkcert:

```
sudo ./setup-local-certs.sh --fix-permissions
```

## Infrastructure

Cloud infrastructure (networking, GKE Autopilot, Cloud Run, Cloud SQL,
Redis, HTTPS Load Balancer) is Terraform-managed — see
**[IaC/README.md](IaC/README.md)**. `IaC/` is expected to move to a
private deploy-only repo before launch — see [TODO.md](TODO.md) for why
and the plan.

## Security

**[SECURITY.md](SECURITY.md)** is the source of truth for this repo's
security posture — repo/branch settings, CI/CD trust boundaries, and the
supply-chain policy for dependencies and GitHub Actions. Report
vulnerabilities via [GitHub's private advisory
form](https://github.com/Selkomark/MinCirklen.dk/security/advisories/new),
not a public issue.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for noncommercial use.
Copyright [Selkomark](https://selkomark.com).
