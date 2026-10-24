# Deployment

FAULTLINE has two services with different runtime needs. Deploy them separately.

| Service | Runtime | Scale | Needs |
|---|---|---|---|
| Web (`apps/web`) | Node.js 22+, `next start` | Stateless; any number of instances | PostgreSQL, S3, HTTPS termination |
| Worker (`apps/worker`) | Node.js 22+ long-running process | One or more persistent hosts | PostgreSQL, S3, Playwright Chromium + system libraries, outbound internet, network isolation |

**Do not run the worker in a serverless function.** It launches Chromium, holds a browser for up to `FAULTLINE_SCENARIO_TIMEOUT_MS` per execution, runs a local proxy, and heartbeats scans. Serverless platforms are not a reliable home for that. The web app never launches a browser and can run anywhere Next.js runs, but it needs a direct PostgreSQL connection (pg-boss producer) and network access to the object store.

## Configuration

All configuration is environment variables; `.env.example` documents each one. Both services read the same core variables (`DATABASE_URL`, `S3_*`, `FAULTLINE_DEPLOYMENT_MODE`, `FAULTLINE_SCAN_ALLOWLIST`, `FAULTLINE_SUBRESOURCE_POLICY`). Both validate configuration at startup and exit with a list of problems if it is invalid. Real environment variables take precedence over the repository `.env`.

Never put AI provider, Devin, or GitHub credentials in `NEXT_PUBLIC_*` variables. Phase 1 needs none of them.

## Build

```bash
pnpm install --frozen-lockfile
pnpm build                    # apps/web/.next and apps/worker/dist/main.js
pnpm db:migrate               # run once per release, before starting new versions
```

The worker bundle keeps third-party dependencies external, so deploy it together with the installed workspace (`node_modules` from `pnpm install --frozen-lockfile --prod` on the target host). Producing a pruned standalone directory is possible with `pnpm deploy` but is not scripted or verified in Phase 1. Install Chromium on the worker host with `pnpm --filter @faultline/worker exec playwright install --with-deps chromium`.

## Web service

- Start: `pnpm --filter @faultline/web start` (or `next start -p $PORT` in `apps/web`).
- Serve only over HTTPS behind a reverse proxy (Caddy, nginx, a load balancer). `NODE_ENV=production` makes session cookies `Secure` with the `__Host-` prefix.
- Health check: `GET /api/health` returns `{"ok":true}` when the database is reachable.
- If you run multiple instances, add login rate limiting at the proxy (FAULTLINE's limiter is per process).

## Worker service

- Start: `node --env-file-if-exists=.env apps/worker/dist/main.js` under a supervisor (systemd, a container orchestrator). It handles `SIGTERM` gracefully: stops taking jobs, waits up to 30 s for running scans, and marks itself stopped.
- Concurrency: `FAULTLINE_WORKER_CONCURRENCY` scans per process (each scan launches its own Chromium). Budget roughly 300–600 MB RAM per concurrent scan.
- Isolation: required for `public` mode. See [security.md](security.md#why-application-checks-are-not-enough-for-public-deployments).
- If a worker dies mid-scan, another worker marks the scan `failed` (`worker_interrupted`) after 90 s without a heartbeat.

Example systemd unit:

```ini
[Unit]
Description=FAULTLINE scan worker
After=network-online.target

[Service]
User=faultline
WorkingDirectory=/opt/faultline
EnvironmentFile=/etc/faultline/worker.env
ExecStart=/usr/bin/node apps/worker/dist/main.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/faultline /home/faultline/.cache/ms-playwright

[Install]
WantedBy=multi-user.target
```

## Data services

- PostgreSQL 15+ (developed against 17). Use a dedicated role that owns only the FAULTLINE database. pg-boss creates its tables in the `pgboss` schema on first start.
- S3-compatible storage: a private bucket. MinIO, AWS S3, Cloudflare R2, and similar work through the AWS SDK (`S3_FORCE_PATH_STYLE=true` for MinIO). The worker creates the bucket if it does not exist; pre-create it and grant `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` if your policy forbids bucket creation.
- Upstream MinIO stopped publishing container images; `docker-compose.yml` uses Chainguard's build of the open-source server, pinned by digest. Substitute any S3-compatible service.

## Production readiness checklist

Ready in Phase 1:

- [x] Configuration validated at startup; secrets only in environment
- [x] Migrations versioned and idempotent
- [x] Operator authentication with hashed passwords and server-side sessions
- [x] Origin allowlist enforced at project creation, scan creation, and execution
- [x] Egress guard with private/metadata blocking, DNS pinning, redirect coverage
- [x] Chromium sandbox on, preflight before taking jobs
- [x] Timeouts, redirect/request/transfer budgets, bounded concurrency
- [x] Durable queue; crash recovery for interrupted scans; graceful shutdown
- [x] Private artifact storage with integrity hashes

Not ready yet (do these before exposing FAULTLINE beyond trusted operators):

- [ ] OS/network-level egress isolation for the worker (your infrastructure)
- [ ] HTTPS reverse proxy with rate limiting in front of the web app
- [ ] Content security policy with nonces for the web app
- [ ] Session management UI and password-change revocation
- [ ] Domain-ownership verification instead of a static allowlist
- [ ] Data retention: scans, events, and artifacts are kept until you delete them (no retention job yet)
- [ ] Backups for PostgreSQL and the bucket
- [ ] Container images and orchestration manifests (not provided in Phase 1)
- [ ] Structured log shipping and metrics (the worker logs JSON lines to stdout)
