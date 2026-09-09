# Real (non-dev) Vault server for the local dev stack — file storage so the
# Transit key survives `docker compose down`/`up` and container restarts,
# same as postgres/redis/nats already do. See docker-compose.yml's `vault`
# service and SECURITY.md's "Local KMS emulator" section.

storage "file" {
  # /vault/file, not an arbitrary path: the image's own entrypoint script
  # only auto-chowns /vault/config, /vault/logs, and /vault/file for the
  # non-root `vault` user it runs as — a bind-mounted volume anywhere else
  # stays root-owned and Vault can't write to it.
  path = "/vault/file"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}

api_addr      = "http://127.0.0.1:8200"
disable_mlock = true
ui            = true
