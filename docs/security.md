# Security model

FAULTLINE drives a real browser against websites. Treat the browser, the pages it loads, and everything they return as untrusted.

## Threats considered

| Threat | Control |
|---|---|
| Server-side request forgery to internal services or cloud metadata | Origin allowlist at project and scan creation and again at execution; egress guard on every browser connection; metadata IPs always denied |
| Redirect to an internal or unauthorized host | Guard checks each new connection (covers HTTP redirects); main-frame navigations outside the allowlist are refused and the run stops with `left_authorized_scope` |
| DNS rebinding / mixed DNS answers | Guard resolves once, requires every address to pass, connects to the checked address |
| Obfuscated IP forms (`2130706433`, `0x7f.1`, `::ffff:127.0.0.1`, NAT64, 6to4) | WHATWG URL canonicalization plus IPv6-embedded IPv4 extraction before classification |
| Subresources, iframes, WebSockets, service workers bypassing checks | All go through the browser network stack, which is forced through the guard; WebRTC restricted to proxied UDP |
| Resource exhaustion by hostile pages | Navigation/scenario timeouts, redirect limit, request budget, transfer budget, screenshot height limit, evidence count and length caps, bounded worker concurrency |
| Leaking secrets into stored evidence | No headers, cookies, or bodies are stored; URLs have credentials removed and sensitive query parameters masked; console text has bearer tokens, JWTs, and `key=value` secrets masked |
| Page text treated as instructions | Evidence is stored and rendered as plain text (React escaping); nothing in FAULTLINE executes or interprets page content |
| Unauthorized use of the app | Operator accounts only; scrypt password hashes; opaque 256-bit session tokens stored as SHA-256; `httpOnly`, `SameSite=Lax`, `Secure` + `__Host-` in production; every page, action, and API validates the session server-side; login throttling; Server Actions' built-in origin check against CSRF |
| Artifact path traversal or public exposure | Keys built only from server UUIDs and validated by pattern; bucket stays private; screenshots streamed only to signed-in operators with `nosniff` and a restrictive CSP |

## Deployment modes

- `FAULTLINE_DEPLOYMENT_MODE=local` (default): operator-only use on a workstation or private host. Allowlisted origins may resolve to loopback or private addresses (for example `http://localhost:4600`). Non-allowlisted private destinations are refused.
- `FAULTLINE_DEPLOYMENT_MODE=public`: non-public addresses are refused even if allowlisted. The worker **refuses to start** unless `FAULTLINE_NETWORK_ISOLATION_ACK=true`, which you should set only after enforcing network isolation below.

`FAULTLINE_SUBRESOURCE_POLICY=allowlist` restricts every browser connection to allowlisted origins (stricter; many sites will break because CDNs are blocked). The default `public` allows public hosts on ports 80/443.

## Why application checks are not enough for public deployments

The egress guard runs inside the worker process. A Chromium or Node.js vulnerability, a misconfiguration, or a future code path could bypass it. For any deployment reachable by anyone other than you, also isolate the worker at the network layer:

- Run the worker in its own container, VM, or network namespace with **no route** to private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `169.254.0.0/16`, `fc00::/7`, `fe80::/10`, loopback of other hosts) except PostgreSQL and object storage.
- Block instance metadata explicitly (`169.254.169.254`, `fd00:ec2::254`; on AWS also require IMDSv2 with hop limit 1).
- Example (nftables on the worker host, adjust addresses):

```
table inet faultline_worker {
  chain output {
    type filter hook output priority 0; policy accept;
    meta skuid "faultline" ip daddr { 10.20.0.5 } tcp dport { 5432, 9000 } accept   # your DB and S3 only
    meta skuid "faultline" ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16 } drop
    meta skuid "faultline" ip6 daddr { fc00::/7, fe80::/10 } drop
  }
}
```

Until that isolation exists, keep FAULTLINE in `local` mode and restricted to operators you trust.

## Browser sandbox

The worker launches Chromium with its sandbox enabled (`FAULTLINE_CHROMIUM_SANDBOX=true`) and refuses to take jobs if the preflight launch fails. Some container runtimes need user namespaces or a seccomp profile for the sandbox. Disabling it (`false`) removes a major defense; only do so inside a dedicated, isolated VM.

## Blast Radius safety controls

- **Journeys are data, not code.** Steps are a closed set of Playwright operations with structured locators. CSS selectors refuse engine prefixes (`xpath=`, `text=`) and `>>` chaining. Navigation paths must start with a single `/` and must resolve on the project origin. FAULTLINE never runs JavaScript supplied by an operator or by the scanned site. The only page evaluations are FAULTLINE's own fixed layout measurements.
- **No data changes by default.** Every POST, PUT, PATCH, and DELETE request is blocked in the browser and recorded as a safety block (`policy_block`), separate from injected faults. A journey may allow an exact method and path only when it is safe to call repeatedly against that environment.
- **Password fields are never filled.** A `fill` step aimed at `input[type=password]` fails with an explanation.
- **Injected outcomes are labeled.** Aborted, delayed, and generated responses are stored as `injected` in the network log and as `fault_injected` events. They are excluded from "natural" failure counts. Generated error responses carry `x-faultline-injected: 1`.
- **Capacity limits.** Each project may have one queued or running analysis. Across the server, `FAULTLINE_MAX_ACTIVE_ANALYSES` applies (default 2). Both checks run under a PostgreSQL advisory lock, so concurrent launches cannot both pass. Each analysis has a time budget (`FAULTLINE_ANALYSIS_TIMEOUT_MS`) and an experiment limit (at most 20).
- **Regression test validation** runs generated tests in a temporary directory under the worker. Chromium is forced through the egress guard with per-run proxy credentials, and the directory is deleted afterwards. A generated test contains only the journey's own data, escaped as string literals.
- **What is stored.** Redacted URLs, methods, statuses, timings, step results, and screenshots. No request or response headers, cookies, tokens, or bodies.

## Known limitations

- Login throttling is in memory per web process. Put a rate-limiting reverse proxy in front of multi-instance deployments.
- Sessions are revoked on sign-out and expire after `FAULTLINE_SESSION_TTL_HOURS`; there is no UI to list or revoke other sessions yet. Changing a password with `pnpm operator:create` does not revoke existing sessions.
- No content security policy is applied to the web app's own pages yet (Next.js inline scripts require nonce support to be wired in). Other security headers are set.
- Domain-ownership verification (DNS TXT or HTTP file) is not implemented; the allowlist is the authorization source. The allowlist check is a single function (`checkScanTarget`) so verification can be added there.
- The transfer budget counts body bytes for plain HTTP and raw tunnel bytes for HTTPS.
- Values typed by `fill` steps are stored in the journey definition in plain text. Do not put real credentials in journeys.
- Screenshots can contain whatever the page displays. Use journey screenshot masks for sensitive regions.

Report vulnerabilities as described in [SECURITY.md](../SECURITY.md).
