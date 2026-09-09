#!/usr/bin/env bash
# Generates a locally-trusted TLS cert for dev-mincirklen.dk (+ subdomains)
# so the local stack can run under https://. NOT executed automatically —
# run it yourself:
#
#   ./setup-local-certs.sh
#
# Uses mkcert: it maintains a local CA (created once per machine, under
# mkcert -CAROOT) and installs its root into your system/browser trust
# stores, then mints a leaf cert off that CA for the given domains. Nothing
# under mkcert -CAROOT is ever touched if it already exists — this only
# adds a leaf cert for dev-mincirklen.dk, it doesn't recreate the CA or
# affect certs mkcert has issued for any other project on this machine.
#
# Safe to re-run: regenerates the leaf cert in place; `mkcert -install` is
# a no-op if the CA is already trusted.
#
# If Caddy fails with "permission denied" reading the key file — usually
# because a previous run of this script got invoked with sudo by mistake,
# leaving the cert/key owned by root — fix just the ownership/permissions
# with the isolated flag below (does NOT regenerate certs or touch mkcert):
#
#   sudo ./setup-local-certs.sh --fix-permissions

set -euo pipefail

DOMAIN="dev-mincirklen.dk"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="${REPO_ROOT}/local-infra/caddy/certs"
CERT_FILE="${CERT_DIR}/${DOMAIN}.pem"
KEY_FILE="${CERT_DIR}/${DOMAIN}-key.pem"

log() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
die() {
  printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2
  exit 1
}

if [[ "${1:-}" == "--fix-permissions" ]]; then
  # Isolated on purpose: this is the ONLY part of the script that should
  # ever run under sudo. It just re-chowns/chmods files that already
  # exist — it doesn't touch mkcert or generate anything.
  [[ "$(id -u)" -eq 0 ]] || die "--fix-permissions must be run with sudo: sudo ./setup-local-certs.sh --fix-permissions"
  [[ -n "${SUDO_USER:-}" ]] || die "Run this via sudo (not as root directly) so it knows which user to hand the files back to: sudo ./setup-local-certs.sh --fix-permissions"
  [[ -f "$CERT_FILE" && -f "$KEY_FILE" ]] || die "No certs found at ${CERT_DIR} yet — run ./setup-local-certs.sh (without sudo) first to generate them."

  TARGET_UID="$(id -u "$SUDO_USER")"
  TARGET_GID="$(id -g "$SUDO_USER")"

  log "Restoring ${SUDO_USER}'s ownership of the cert/key and making them readable."
  chown "${TARGET_UID}:${TARGET_GID}" "$CERT_FILE" "$KEY_FILE"
  chmod 644 "$CERT_FILE" "$KEY_FILE"

  log "Done. Recreate Caddy so it picks up the fix: docker compose up -d --force-recreate caddy"
  exit 0
fi

command -v mkcert >/dev/null 2>&1 || die "mkcert is required. Install it with: brew install mkcert (and 'brew install nss' if you also use Firefox)."

if [[ "$(id -u)" -eq 0 ]]; then
  die "Don't run this with sudo. mkcert prompts for elevation itself if it actually needs it for the system trust store; running the whole script as root instead makes the CA install into root's trust store (browsers won't trust it) and leaves the generated cert/key owned by root. Docker Desktop's file-sharing daemon runs as your normal user, so a root-owned key file can't be bind-mounted into containers and Caddy fails with 'permission denied'. If you already hit that, fix it in isolation with: sudo ./setup-local-certs.sh --fix-permissions"
fi

log "Ensuring mkcert's local CA is trusted (installs it into the system/browser trust stores if not already; no-op otherwise)."
mkcert -install

mkdir -p "$CERT_DIR"

log "Generating a cert for ${DOMAIN} and its subdomains -> ${CERT_DIR}"
mkcert \
  -cert-file "$CERT_FILE" \
  -key-file "$KEY_FILE" \
  "$DOMAIN" "*.${DOMAIN}"

chmod 644 "$CERT_FILE" "$KEY_FILE"

cat <<EOF

Done. Certs written to:
  ${CERT_FILE}
  ${KEY_FILE}

Next: (re)start Caddy so it picks them up:
  docker compose up -d --build caddy

Then visit: https://${DOMAIN}
EOF
