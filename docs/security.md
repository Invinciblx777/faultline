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

## Repair integration controls (Phase 3)

- **Credentials** (`DEVIN_API_KEY`, `DEVIN_ORG_ID`, `GITHUB_TOKEN`) are read only on the server, sent only in `Authorization` headers, never logged, never stored in rows, and never placed in prompts. Logs record only whether each integration is configured.
- **No spend without approval.** Sessions are created only by the worker, only for requests an operator on `FAULTLINE_REPAIR_APPROVERS` approved after confirming a statement, and only if the evidence checksum still matches what was shown. Page loads, polling, and the connection test (`GET /v3/self`) never create sessions.
- **Fail-closed repository-access preflight.** Devin's access to the request's exact repository is checked live (`GET /v3/self`, then `GET /v3/organizations/{org}/repositories`), never taken from a cached result: once when the operator approves, and again by the worker before it uploads screenshots or creates the session. The check fails on rejected credentials, a key from another organization, a refused or failed API request, a repository Devin does not list, a non-GitHub connection, or a project relinked to a different repository since the request was prepared. A failed check at approval leaves the request unapproved; in the worker it marks the request `devin_failed` with the reason, and nothing is sent. The UI disables approval unless a successful check is under 10 minutes old.
- **At most one session per approval.** The request is claimed atomically before the API call. Ambiguous failures (timeouts, 5xx) are not retried; the session is looked up by its unique tag. A database unique index prevents two open requests for one finding.
- **Repository authorization.** Only repositories on `FAULTLINE_REPAIR_REPOSITORIES` can be linked; pull requests are accepted only when GitHub confirms them for the linked repository and base branch, from a different branch, with a full head SHA. FAULTLINE has no code path that merges, pushes, or comments.
- **Evidence sanitization.** Page-derived text is scrubbed of bearer tokens, JWTs, secret-looking key/value pairs, and URL query values (FAULTLINE's standard redaction), plus Devin and GitHub tokens, AWS access key ids, private keys, database connection strings, and cookie headers, and is fenced in the prompt as untrusted data. The prompt forbids weakening tests or security controls and requires the regression test to stay byte-for-byte unchanged.
- **Untrusted code runs only in containers.** Candidate commits are never executed on the host. The recipe is data (`node <entry>` plus port variable names); shell commands, absolute paths, and `..` are rejected. Containers have no outbound network, a read-only root file system, no capabilities, and resource limits. Projects with runtime dependencies are refused rather than installed.
- **Test integrity.** The regression test's SHA-256 is recorded with the request and checked before every run; a mismatch blocks verification.
- **Devin messages are not evidence.** They are stored and shown as Devin's words. Only FAULTLINE's own runs decide verdicts.

## Known limitations

- Repair verification supports Node.js servers without runtime dependencies. Other stacks are refused, not approximated.
- The container's internal network still lets the candidate reach other containers on the same network; FAULTLINE runs one candidate at a time and removes it afterwards.

- Login throttling is in memory per web process. Put a rate-limiting reverse proxy in front of multi-instance deployments.
- Sessions are revoked on sign-out and expire after `FAULTLINE_SESSION_TTL_HOURS`; there is no UI to list or revoke other sessions yet. Changing a password with `pnpm operator:create` does not revoke existing sessions.
- No content security policy is applied to the web app's own pages yet (Next.js inline scripts require nonce support to be wired in). Other security headers are set.
- Domain-ownership verification (DNS TXT or HTTP file) is not implemented; the allowlist is the authorization source. The allowlist check is a single function (`checkScanTarget`) so verification can be added there.
- The transfer budget counts body bytes for plain HTTP and raw tunnel bytes for HTTPS.
- Values typed by `fill` steps are stored in the journey definition in plain text. Do not put real credentials in journeys.
- Screenshots can contain whatever the page displays. Use journey screenshot masks for sensitive regions.

Report vulnerabilities as described in [SECURITY.md](../SECURITY.md).
