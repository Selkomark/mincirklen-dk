#!/usr/bin/env bash
# Extracts the Google OAuth client ID/secret from the credentials JSON you
# downloaded from Google Cloud Console (Auth Platform -> Clients -> your
# "Web application" client -> download JSON) into a root-level .env file,
# which `docker compose` auto-loads for ${VAR} interpolation in
# docker-compose.yml — no env_file: directive needed.
#
# Usage:
#   ./setup-oauth-env.sh
#
# Expects the JSON at:
#   services/web-app/service-accounts/oAuthMincirklenServiceAccount.json
# (gitignored — never commit it). Safe to re-run: idempotently upserts just
# the two GOOGLE_CLIENT_* keys in .env, leaving any other lines untouched.
#
# Without this, docker-compose.yml's trpc-api service still boots fine —
# Google login is an optional layer on top of anonymous auth — but
# /auth/google/start returns 503 until these are set.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREDENTIALS_FILE="${REPO_ROOT}/services/web-app/service-accounts/oAuthMincirklenServiceAccount.json"
ENV_FILE="${REPO_ROOT}/.env"

log() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
die() {
  printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2
  exit 1
}

[[ -f "$CREDENTIALS_FILE" ]] || die "No credentials file at ${CREDENTIALS_FILE}. Download it from Google Cloud Console (Google Auth Platform -> Clients -> your Web application client -> download JSON) and save it there first."
command -v python3 >/dev/null 2>&1 || die "python3 is required to parse the credentials JSON."

CLIENT_ID="$(python3 -c "import json; print(json.load(open('${CREDENTIALS_FILE}'))['web']['client_id'])")"
CLIENT_SECRET="$(python3 -c "import json; print(json.load(open('${CREDENTIALS_FILE}'))['web']['client_secret'])")"

[[ -n "$CLIENT_ID" && -n "$CLIENT_SECRET" ]] || die "Could not read client_id/client_secret from ${CREDENTIALS_FILE} — is it the standard Google-downloaded format?"

touch "$ENV_FILE"

python3 - "$ENV_FILE" "$CLIENT_ID" "$CLIENT_SECRET" <<'PY'
import sys

env_file, client_id, client_secret = sys.argv[1:4]
desired = {"GOOGLE_CLIENT_ID": client_id, "GOOGLE_CLIENT_SECRET": client_secret}

with open(env_file) as f:
    lines = f.read().splitlines()

seen = set()
output = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else None
    if key in desired:
        output.append(f"{key}={desired[key]}")
        seen.add(key)
    else:
        output.append(line)

for key, value in desired.items():
    if key not in seen:
        output.append(f"{key}={value}")

with open(env_file, "w") as f:
    f.write("\n".join(output) + "\n")
PY

log "Wrote GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET to ${ENV_FILE}."

cat <<EOF

Next: (re)start trpc-api so it picks these up:
  docker compose up -d --build trpc-api

Then visit https://dev-mincirklen.dk/login and click "Continue with Google".
EOF
