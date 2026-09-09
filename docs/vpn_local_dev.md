# Remote access to local dev via VPN

Lets a phone or laptop off your home LAN (e.g. traveling, cellular data)
reach `https://dev-mincirklen.dk` exactly like it works on your Mac —
tunneling in via WireGuard ([wg-easy](https://github.com/wg-easy/wg-easy))
to a `vpn` service in `docker-compose.yml`. Entirely optional and
profile-gated: a plain `docker compose up -d` / `down` never touches it.

This doc is deliberately detailed, including the mistakes made and fixed
while setting this up the first time, so the next person doesn't repeat
them.

## Prerequisites

- `./setup-local-dns.sh` already run at least once (generates
  `local-infra/dns/dnsmasq.conf`, pointing `dev-mincirklen.dk` at your
  Mac's LAN IP instead of `127.0.0.1` — a tunneled client can't do anything
  with a loopback answer).
- `./setup-local-certs.sh` already run (the mkcert-issued TLS cert your
  phone will need to trust — see step 5).
- Access to your home router's admin panel, to add a port-forward rule.
- If your home internet doesn't have a static public IP: a free
  dynamic-DNS hostname (e.g. [DuckDNS](https://www.duckdns.org)) pointed at
  your home IP. Check your router's WAN/Internet IP page — if it matches
  what a "what's my IP" site reports, you likely don't need this and can
  use the bare IP; if not (CGNAT), DDNS won't fix that either and this
  setup won't work reliably until that's resolved with your ISP.

## Setup

1. Run the script:

   ```
   ./setup-local-vpn.sh
   ```

   This detects your LAN IP, starts the `vpn` service, and prints the same
   steps below.

2. **Complete the wg-easy setup wizard** — open
   `http://<your-LAN-IP>:51821/` in a browser on your Mac (first visit
   only; this creates the admin account). wg-easy v15 has no
   environment-variable configuration for this — it's all done through the
   web UI, and no secret material lands in this repo.

   - Set a username/password for the admin UI.
   - Endpoint/host: the public hostname or IP clients will dial (your
     DDNS hostname, or your router's public IP if static).
   - DNS handed to clients: your Mac's LAN IP (what `setup-local-vpn.sh` printed).

3. **Change the interface's listening port to 443**, in the wg0 interface
   settings (Settings/Interfaces in the admin UI). `docker-compose.yml`
   publishes UDP `443` (not the wg-easy default `51820`) because some
   mobile carriers/middleboxes are more lenient with 443 traffic. This step
   isn't strictly required for correctness — 51820 works too, as long as
   the docker-compose port mapping and router forward match whatever you
   pick — but 443 is the tested default here.

   > [!WARNING]
   > **This is the step that broke everything the first time.** The same
   > settings form has a **Device** field right next to the port field —
   > leave it as `eth0`. It's an easy mistake to change it to `wg0` since
   > you're right there editing WireGuard's own settings, but `eth0` is the
   > container's *real* network interface (what forwarded traffic needs to
   > exit through to reach anything) — `wg0` is the WireGuard tunnel
   > interface itself, and is wrong here. Setting it to `wg0` silently
   > breaks NAT for **all** forwarded traffic: the handshake still
   > succeeds (small control packets get through fine), but every actual
   > request — DNS, HTTPS, everything — hangs or times out, because
   > replies come back addressed to an unroutable internal tunnel IP that
   > nothing outside the container knows how to reach. This is exactly
   > as confusing to debug as it sounds; see [Troubleshooting](#troubleshooting)
   > below if you're chasing this symptom.

4. **Forward UDP port 443** on your router to your Mac's LAN IP (external
   port 443 → internal host `<LAN-IP>`, internal port 443, protocol UDP).
   Port `51821` (the admin UI) does **not** need forwarding — it's only
   ever reachable on your LAN or through the tunnel itself once connected,
   deliberately, to avoid exposing an admin login to the raw internet.

5. **Add your phone as a client** in the admin UI. Before saving, set:

   - **MTU: 1280** — the safe universal minimum (avoids IPv4/IPv6
     fragmentation black holes over real-world mobile paths; the default
     1420 can silently drop larger packets like TLS handshakes on some
     networks).
   - **Persistent Keepalive: 25** (seconds) — without this, a mobile
     carrier's NAT can forget your phone's "return address" during idle
     gaps, so the server's replies never arrive even though it sent them
     correctly. This matters specifically for cellular clients.

   Then scan the QR code it gives you in the WireGuard app on your phone.

6. **Trust this Mac's mkcert root CA on your phone**, so HTTPS to
   `https://dev-mincirklen.dk` doesn't warn (it's a real, valid cert — just
   signed by a CA your phone doesn't know about yet):

   ```
   mkcert -CAROOT
   ```

   AirDrop or email the `rootCA.pem` from that directory to your phone,
   tap it to install the profile (iOS: Settings → General → VPN & Device
   Management), then separately enable full trust for it: Settings →
   General → About → Certificate Trust Settings.

Once connected, `https://dev-mincirklen.dk` on your phone works exactly
like it does on your Mac.

## The Docker Desktop hairpin problem (and why there's a DNAT fix)

Even with the Device field correct, tunneled HTTPS requests to
`dev-mincirklen.dk` stalled after the TLS handshake — DNS worked, general
internet through the tunnel worked, but reaching Caddy specifically didn't.
The difference: general internet traffic genuinely leaves the Mac and comes
back: a normal, well-supported NAT path. Traffic to `dev-mincirklen.dk`
resolves to this Mac's own LAN IP, so it has to "hairpin" — leave the `vpn`
container, traverse Docker Desktop's virtualized networking back to the
Mac's own network stack, and arrive at a port the same Mac already
publishes. That loop turned out to be unreliable in practice under Docker
Desktop for macOS specifically (confirmed with an isolated container client
dialing the tunnel's real public endpoint directly — no phone, no carrier,
no Wi-Fi involved — reproducing the exact same stall).

The fix, since `vpn` and `caddy` already sit on the same Docker network:
instead of letting that traffic hairpin through the host, redirect it
straight to Caddy's container IP with a DNAT rule. `./setup-local-vpn.sh`
installs this automatically (as a wg-easy "hook" stored in its own
database, so it's regenerated correctly every time the interface restarts
— not a one-off manual patch). If you ever wipe the `vpn` service's data
volume (`docker compose down -v` or similar) and start fresh, just re-run
`./setup-local-vpn.sh` to reinstall it.

## Why some of this is the way it is

- **`dns` is bound to all interfaces, not just `127.0.0.1`**: a tunneled
  client needs to reach it to resolve `dev-mincirklen.dk`.
- **`local-infra/dns/dnsmasq.conf` forwards to public resolvers
  (`1.1.1.1`, `8.8.8.8`)**, not just answering `dev-mincirklen.dk`: a
  WireGuard client's `DNS` setting applies to *every* query system-wide
  while the tunnel is active, not just queries for this domain. Without
  upstream forwarding, connecting the VPN breaks DNS resolution for
  everything else on your phone (this was mistaken for "the tunnel is
  broken" before the real cause was found).
- **The `vpn` service sets `INSECURE=true`**: wg-easy marks its admin-UI
  session cookie `Secure` by default, which browsers silently refuse to
  store over plain `http://`. Since this admin UI is only ever reached
  over LAN or through the tunnel (never the raw internet, by design — see
  step 4), there's no TLS in front of it, so login would otherwise appear
  to fail even with correct credentials.

## Troubleshooting

If the tunnel handshakes successfully (shows "Connected" on the phone,
`docker compose exec vpn wg show` shows a recent handshake) but nothing
actually loads — no DNS, no HTTPS, general internet also broken while
connected — suspect the Device-field mistake from step 3 first:

```
# Check what wg-easy actually used to generate the NAT rule:
docker compose exec vpn sh -c 'grep PostUp /etc/wireguard/wg0.conf'
# Should contain "-o eth0" twice (one for IPv4, one for IPv6 POSTROUTING).
# If it says "-o wg0" instead, that's the bug.

# Confirm via the live firewall rule and its packet counter:
docker compose exec vpn iptables -t nat -L POSTROUTING -n -v
# A MASQUERADE rule with "0 packets, 0 bytes" that never grows while you're
# actively testing means forwarded traffic isn't being NAT'd at all.
```

To fix it, correct the interface's `device` field back to `eth0` in the
admin UI's wg0 settings and save (this regenerates the config correctly).
If that doesn't stick, the value can be corrected directly in wg-easy's
database and the container restarted to pick it up cleanly:

```
docker compose exec vpn sh -c "apk add --no-cache sqlite >/dev/null 2>&1; \
  sqlite3 /etc/wireguard/wg-easy.db \"UPDATE interfaces_table SET device='eth0' WHERE name='wg0';\""
docker compose up -d --force-recreate vpn
```

If the Device field is correct (`eth0`) and DNS/general-internet-through-the-
tunnel both work, but HTTPS to `dev-mincirklen.dk` specifically stalls after
the TLS handshake starts — that's the
[Docker Desktop hairpin problem](#the-docker-desktop-hairpin-problem-and-why-theres-a-dnat-fix)
above, not the Device-field bug. Check whether the DNAT fix is actually
installed and being used:

```
docker compose exec vpn iptables -t nat -L PREROUTING -n -v
# Should show two DNAT rules (tcp dpt:443 and dpt:80) targeting Caddy's
# container IP. If they're missing, re-run ./setup-local-vpn.sh to
# reinstall them. If they're there but show "0 packets" while you're
# actively testing, the rule isn't matching — check that the destination
# IP in the rule still matches your current LAN IP (re-run
# ./setup-local-vpn.sh if your LAN IP has changed since it was installed).
```

Other things worth checking, in rough order of likelihood:

- **Admin UI login "not working" despite correct credentials**: check
  `docker compose logs vpn` for `New Session` lines — if a session *is*
  being created server-side on every attempt, your browser isn't keeping
  the cookie. Confirm `INSECURE=true` is set on the `vpn` service (should
  be, by default, in this repo's `docker-compose.yml`).
- **`ERR_NAME_NOT_RESOLVED` for `dev-mincirklen.dk` specifically, other
  sites fine**: the client's `DNS` field is empty — set it when editing
  the client, then re-import the config on the device (editing server-side
  doesn't retroactively update an already-imported tunnel).
- **Router shows your port-forward rule but it seems to have no effect**:
  some router UIs stage edits until you click "Apply" separately from
  saving the rule row — refresh the page to confirm it actually persisted.
- **Genuinely stuck**: an isolated Docker container running as a
  WireGuard client with the exact same config file (minus the `DNS =`
  line, which needs `resolvconf` that a minimal container won't have) is a
  good way to reproduce the problem without needing the phone at all —
  useful for packet-capturing (`tcpdump`) both sides of a request to see
  exactly where it stalls. Point the test client's `Endpoint` directly at
  the `vpn` container's internal Docker IP (`docker network inspect
  <compose-project>_default`) to also rule out the router/WAN path
  entirely, narrowing the problem down to the `vpn` container itself.
