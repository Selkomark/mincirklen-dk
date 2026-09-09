#!/usr/bin/env bash
# Starts the optional `vpn` service (WireGuard via wg-easy, docker-compose.yml)
# so a phone or laptop off your LAN can tunnel in and reach dev-mincirklen.dk.
# NOT executed automatically anywhere — run it yourself when you're ready:
#
#   ./setup-vpn.sh
#
# Requires ./setup-local-dns.sh to have been run at least once first (it's
# what generates local-infra/dns/dnsmasq.conf and detects your LAN IP).
#
# wg-easy v15 has no environment-variable setup (no WG_HOST/PASSWORD_HASH) —
# the admin account and WireGuard endpoint/DNS settings are configured
# through a web setup wizard on first visit. This script just starts the
# container (profile-gated, so this is the only thing that starts it — a
# plain `docker compose up -d` never touches it), installs a DNAT fix
# (below) so tunneled clients can actually reach Caddy, and walks you
# through the rest.
#
# Why the DNAT fix: a tunneled client's traffic for dev-mincirklen.dk is
# forwarded by the `vpn` container back out to this Mac's own LAN IP —
# a "hairpin" through Docker Desktop's virtualized networking that turned
# out to be unreliable in practice (DNS and small requests worked, but
# HTTPS to Caddy consistently stalled after the TLS handshake). `vpn` and
# `caddy` are already on the same Docker network, so instead of hairpinning
# through the host, this rewrites the destination straight to Caddy's
# container IP — bypassing the flaky path entirely. See
# docs/vpn_local_dev.md for the full story.
#
# Safe to re-run: if the vpn service is already up, this reapplies the DNAT
# fix (e.g. after your LAN IP changes) and re-prints the next steps.

set -euo pipefail

DOMAIN="dev-mincirklen.dk"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
die() {
  printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2
  exit 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  die "This script only supports macOS (LAN IP detection uses ipconfig). Adapt the detection command for your OS if you're on Linux."
fi

command -v docker >/dev/null 2>&1 || die "docker is required (Docker Desktop or compatible) and wasn't found on PATH."
docker info >/dev/null 2>&1 || die "Docker daemon isn't running. Start Docker Desktop and try again."

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
[[ -n "$LAN_IP" ]] || die "Couldn't detect a LAN IP on en0/en1 — connect to Wi-Fi or Ethernet and re-run."
log "LAN IP: ${LAN_IP}"

if [[ ! -f "${REPO_ROOT}/local-infra/dns/dnsmasq.conf" ]]; then
  die "local-infra/dns/dnsmasq.conf doesn't exist yet — run ./setup-local-dns.sh first (it generates that file and points dev-mincirklen.dk at your LAN IP)."
fi

log "Starting the vpn service."
docker compose -f "${REPO_ROOT}/docker-compose.yml" up -d vpn

# --- Install the DNAT fix (see comment at the top of this file) ---
# wg-easy's own DB template mechanism (hooks_table) is used so this survives
# wg-easy regenerating wg0.conf on its own — it's not a one-off live patch.

log "Waiting for the vpn service's database to be ready..."
for _ in $(seq 1 15); do
  if docker exec mincirklen-vpn sh -c 'test -f /etc/wireguard/wg-easy.db' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec mincirklen-vpn sh -c 'command -v sqlite3 >/dev/null 2>&1 || apk add --no-cache sqlite >/dev/null 2>&1'

HOOKS_SQL_TEMPLATE='UPDATE hooks_table SET
  post_up = '"'"'iptables -t nat -A POSTROUTING -s {{ipv4Cidr}} -o {{device}} -j MASQUERADE; iptables -A INPUT -p udp -m udp --dport {{port}} -j ACCEPT; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT; ip6tables -t nat -A POSTROUTING -s {{ipv6Cidr}} -o {{device}} -j MASQUERADE; ip6tables -A INPUT -p udp -m udp --dport {{port}} -j ACCEPT; ip6tables -A FORWARD -i wg0 -j ACCEPT; ip6tables -A FORWARD -o wg0 -j ACCEPT; CADDY_IP=$(getent hosts caddy | cut -f1 -d" "); iptables -t nat -A PREROUTING -i wg0 -p tcp -d __LAN_IP__ --dport 443 -j DNAT --to-destination ${CADDY_IP}:443; iptables -t nat -A PREROUTING -i wg0 -p tcp -d __LAN_IP__ --dport 80 -j DNAT --to-destination ${CADDY_IP}:80;'"'"',
  post_down = '"'"'iptables -t nat -D POSTROUTING -s {{ipv4Cidr}} -o {{device}} -j MASQUERADE; iptables -D INPUT -p udp -m udp --dport {{port}} -j ACCEPT; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT; ip6tables -t nat -D POSTROUTING -s {{ipv6Cidr}} -o {{device}} -j MASQUERADE; ip6tables -D INPUT -p udp -m udp --dport {{port}} -j ACCEPT; ip6tables -D FORWARD -i wg0 -j ACCEPT; ip6tables -D FORWARD -o wg0 -j ACCEPT; CADDY_IP=$(getent hosts caddy | cut -f1 -d" "); iptables -t nat -D PREROUTING -i wg0 -p tcp -d __LAN_IP__ --dport 443 -j DNAT --to-destination ${CADDY_IP}:443; iptables -t nat -D PREROUTING -i wg0 -p tcp -d __LAN_IP__ --dport 80 -j DNAT --to-destination ${CADDY_IP}:80;'"'"'
WHERE id='"'"'wg0'"'"';'

HOOKS_SQL="${HOOKS_SQL_TEMPLATE//__LAN_IP__/${LAN_IP}}"
echo "$HOOKS_SQL" | docker exec -i mincirklen-vpn sh -c 'sqlite3 /etc/wireguard/wg-easy.db'

log "Applying the DNAT fix (recreating the vpn container so it takes effect)."
docker compose -f "${REPO_ROOT}/docker-compose.yml" up -d --force-recreate vpn >/dev/null

cat <<EOF

Done. This is the short version — see docs/vpn_local_dev.md for full detail,
troubleshooting, and IMPORTANT gotchas (there's an easy mistake in step 1
below that silently breaks everything except the handshake). Remaining
steps:

1. On your Mac's browser, open http://${LAN_IP}:51821/ and complete the
   setup wizard (first visit only — creates the admin account and
   configures the WireGuard endpoint):
     - Endpoint/host: the public hostname clients will dial. If your home
       IP isn't static, set up a free dynamic-DNS hostname first (e.g.
       https://www.duckdns.org) and use that instead of a bare IP.
     - DNS handed to clients: use ${LAN_IP} (this Mac's LAN IP) — that's
       what lets a tunneled client resolve ${DOMAIN}.
   Then in the interface (wg0) settings, change Port from 51820 to 443 to
   match docker-compose.yml's published port. In that same form there's a
   "Device" field — leave it as \`eth0\`. Do NOT change it to \`wg0\` (an easy
   mistake, since you're right there changing the WireGuard port) — this
   silently breaks NAT for all forwarded traffic. See docs/vpn_local_dev.md
   if you already made this mistake; it's fixable.

2. Forward UDP port 443 on your router to this Mac (${LAN_IP}), so the
   WireGuard tunnel port is reachable from outside your home network.
   (Port 51821, the admin UI, does NOT need to be forwarded — only reachable
   on your LAN or once already tunneled in.)

3. In the wg-easy admin UI, add your phone as a client. Before saving,
   set MTU to 1280 and Persistent Keepalive to 25 — both matter for
   reliability on mobile networks (see docs/vpn_local_dev.md for why). Then
   scan the QR code in the WireGuard app.

4. Trust this Mac's mkcert root CA on your phone, so HTTPS to
   https://${DOMAIN} doesn't warn:
     mkcert -CAROOT
   AirDrop or email the rootCA.pem from that directory to your phone, open
   it to install the profile, then on iOS: Settings > General > VPN &
   Device Management to install it, then Settings > General > About >
   Certificate Trust Settings to enable full trust for it.

Once connected, your phone can reach https://${DOMAIN} exactly like this
Mac does.
EOF
