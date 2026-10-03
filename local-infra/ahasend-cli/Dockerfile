# There is no official ahasend-cli image — it's a single Go binary
# published on GitHub Releases (the same one setup-ahasend.sh in the
# sibling selkomark.com repo downloads for a host install;
# docker-compose.yml's ahasend-webhook-forwarder service runs it
# containerized instead). Only linux-amd64 is published for Linux — no
# linux-arm64 release exists (confirmed against the actual release
# assets, not assumed) — so this image is pinned to linux/amd64 in
# docker-compose.yml's `platform:` key regardless of host architecture;
# on Apple Silicon that runs via Docker Desktop's Rosetta emulation, same
# posture as this compose file's own `dns` service.
#
# debian-slim, not alpine: the binary is dynamically linked against
# glibc (`rosetta error: failed to open elf at
# /lib64/ld-linux-x86-64.so.2` under Alpine's musl libc, confirmed by
# actually running it, not assumed) — it needs a real glibc loader
# present, which Alpine deliberately doesn't ship.
FROM --platform=linux/amd64 debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    curl -sLf -o /usr/local/bin/ahasend \
      "https://github.com/AhaSend/ahasend-cli/releases/latest/download/ahasend-linux-amd64" && \
    chmod +x /usr/local/bin/ahasend

ENTRYPOINT ["ahasend"]
