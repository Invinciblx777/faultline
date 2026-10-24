# FAULTLINE

**Break it. Understand it. Fix it. Prove it.**

FAULTLINE is an evidence-first web reliability engineering platform. It loads your website in a real Chromium browser under normal conditions, loads it again under a deliberate fault (failing resources, or the network gone), and shows both runs side by side in **Reality Split**: screenshots, console errors, uncaught exceptions, failed requests, HTTP errors, and a timeline of what each run actually observed.

Every screenshot, error, and number in FAULTLINE comes from a recorded browser execution. Nothing is simulated, seeded, or generated.

> Status: **Phase 2 (Blast Radius)**. Self-hosted, operator-only. See [PHASE_STATUS.md](PHASE_STATUS.md) for exactly what is implemented and verified.

## What it does today

- **Projects** for website origins on a server-side allowlist.
- **Scans** that run two executions in fresh, isolated Chromium contexts:
  - **Resource failure**: abort stylesheets, images, fonts, scripts, media, fetch, or XHR requests inside the browser (first-party, third-party, or all). Intentionally aborted requests are recorded separately from unexpected failures. No response is ever faked.
  - **Offline reload**: load, switch the browser context offline, reload. Clearly labeled as browser-context emulation, not physical network loss.
- **Reality Split**: side-by-side or draggable-seam comparison of the two real screenshots, with per-run conditions, environment, and evidence timelines.
- **Live progress**, **scan history** with search and filters, **cancel** and **run again**.
- **Technical report** with a transparent "can / cannot be concluded" section and a **JSON export** (`faultline.report/v1`) including SHA-256 hashes computed from the stored screenshot bytes.
- **Egress guard**: every browser connection goes through a policy-enforcing proxy that blocks private networks, loopback, link-local, and cloud metadata addresses unless explicitly allowed, including after redirects and DNS rebinding.

### Blast Radius (Phase 2)

- **Journeys**: versioned, declarative user flows (navigate, click, fill, wait, assertions, optional step and journey time budgets, offline expectations). They are built in a structured editor or as JSON. Journeys are data, not code.
- **Dependency discovery** from the requests the browser actually made in two normal runs.
- **Isolated fault experiments**, one per fresh browser context:
  - dependency unavailable
  - first-party API returns 500/503
  - slow response
  - online → offline
  - 360×740 viewport
- **Verdicts** from fixed rules: BROKEN, DEGRADED, RESILIENT, INCONCLUSIVE, TEST FAILED. Findings are re-run once to check that they reproduce.
- **Blast Radius Map** linking each fault to the journey steps it broke or degraded.
- **Reality Split 2.0**: side by side, seam, overlay, and pixel diff against a calibrated threshold.
- **Causal evidence timeline**: injected fault, page reactions, and failed checks on one clock.
- **Executable Playwright regression tests** for each finding. Each is validated by running it with Playwright Test against the site.

Not yet: AI analysis, Devin/GitHub repair, Fault DNA graphs. Typed contracts for the AI and repair integrations live in [`packages/shared/src/contracts`](packages/shared/src/contracts); the UI labels them unavailable.

## Requirements

- Linux, or Windows with WSL2 (run everything inside the WSL distribution).
- Node.js 22.12+ (developed on 24.x) and pnpm 12 (`corepack enable pnpm`).
- Docker with Compose, or Podman with `podman-compose`, for PostgreSQL 17 and MinIO.
- About 500 MB for the Playwright Chromium download.

## Quick start (local)

Run these from the repository root.

```bash
# 1. Install dependencies
corepack enable pnpm
pnpm install

# 2. Create local configuration with generated secrets (.env, mode 600, never committed)
pnpm setup:env

# 3. Start PostgreSQL and MinIO (bound to 127.0.0.1 only)
docker compose up -d          # or: podman-compose up -d

# 4. Create the database schema (and the separate test database's schema)
pnpm db:migrate
pnpm db:migrate:test

# 5. Download Chromium for the worker
pnpm browsers:install
#    On Debian/Ubuntu you may also need system libraries:
#    pnpm --filter @faultline/worker exec playwright install-deps chromium

# 6. Create the first operator (prompts for a password, minimum 12 characters)
pnpm operator:create admin
```

Authorize the origins you are allowed to test by editing `FAULTLINE_SCAN_ALLOWLIST` in `.env` (comma-separated; `https://*.example.com` wildcards are allowed). The default authorizes only the bundled reference target, `http://localhost:4600`, and its simulated third-party partner, `http://localhost:4601`.

Start the three processes in separate terminals:

```bash
pnpm reference-target   # optional: a deliberately imperfect local site on http://localhost:4600
pnpm dev:worker         # scan worker (Playwright Chromium)
pnpm dev:web            # web app on http://localhost:3000
```

Then open http://localhost:3000, sign in, create a project for `http://localhost:4600`, choose **New scan**, and run it. The scan page shows live progress; when both runs finish, open **Reality Split** or **Report**.

To try Blast Radius:

1. Open the project, then **Journeys → New journey**.
2. Describe a flow on the storefront at `/shop/`, for example: open `/shop/`, assert "Trail Backpack" is visible, click "Add Trail Backpack to cart", fill "ZIP code", click "Get shipping quote", and assert the order total.
3. Save the journey, then choose **Analyze blast radius**.
4. When the analysis finishes, select a fault on the map to see its evidence and download its regression test.

### Production-style local run

```bash
pnpm build                       # builds the web app (Next.js) and bundles the worker
pnpm start:worker                # node apps/worker/dist/main.js
pnpm start:web                   # next start on port 3000
```

With `NODE_ENV=production` session cookies are `Secure` with the `__Host-` prefix. Browsers accept them on `http://localhost`; anywhere else, serve the web app over HTTPS (see [docs/deployment.md](docs/deployment.md)).

## The reference target

`tools/reference-target` is a small local website with real, deliberate defects, so you can see FAULTLINE work without pointing it at anything else:

- `/assets/missing-banner.png` returns a real 404 on every load.
- `app.js` reads a CSS custom property to lay out the service grid. When stylesheets fail, it throws `RangeError: Invalid array length` and the grid and API status never render. A resource-failure scan on stylesheets shows this.
- `/pwa/` registers a service worker; an offline-reload scan of it shows the page served from cache while offline.
- `/shop/` is a small storefront: catalog, inventory, recommendations, and a shipping quote, all from JSON APIs. It also loads a reviews widget and an analytics script from a simulated third-party partner on the next port (`:4601`). The coupling is deliberate:
  - Catalog and inventory are loaded together, so either failing hides every product.
  - Recommendations and reviews have fallbacks.
  - The shipping quote shows an error message instead of a total.

It is a test fixture you run yourself. It never populates the product with data on its own.

## Tests

```bash
pnpm typecheck            # all packages
pnpm lint                 # all packages
pnpm test                 # unit + integration: shared, db, web services, worker (real Chromium, PostgreSQL, MinIO, pg-boss)
pnpm test:e2e             # builds the web app, then Playwright E2E against next start + a real worker
```

Integration and E2E tests use `DATABASE_URL_TEST` (a separate `faultline_test` database created by the Compose init script) and separate buckets (`faultline-test-artifacts`, `faultline-e2e-artifacts`). They refuse to run against a database whose name does not end in `_test`.

## Repository layout

```
apps/web               Next.js App Router UI, server actions, authenticated API routes
apps/worker            pg-boss consumer that runs scans with Playwright Chromium + egress guard
packages/db            Drizzle schema, SQL migrations, lifecycle transitions, S3 storage, queue helpers
packages/shared        Zod contracts, URL/allowlist/IP policy, redaction, report builder, future AI/repair contracts
tools/reference-target Local test website with deliberate defects
infra/postgres/init    Compose init script (creates the test database)
docs/                  Architecture, security, deployment, API
```

## Documentation

- [Architecture](docs/architecture.md)
- [Security model](docs/security.md) and [security policy](SECURITY.md)
- [Deployment](docs/deployment.md), including the production readiness checklist
- [HTTP API and report format](docs/api.md)
- [Contributing](CONTRIBUTING.md)
- Hackathon: [Rules](RULES.md), [Agent guide](AGENTS.md), [Submission](SUBMISSION.md), [Change log](CHANGELOG.md), [AI usage](AI_USAGE.md)

## License

[MIT](LICENSE)
