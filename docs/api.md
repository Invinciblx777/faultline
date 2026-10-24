# HTTP API and report format

All routes except `/api/health` require a signed-in operator session cookie and return `401 {"error":"unauthorized"}` otherwise. Mutations (sign-in, projects, scans, cancel, rerun) are Next.js Server Actions, not public REST endpoints, so they inherit Next.js's same-origin checks.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{"ok":true}` or `503 {"ok":false}`; reveals only database reachability |
| GET | `/api/scans/{scanId}` | Live status: `status`, `phase`, `cancelRequestedAt`, `startedAt`, `finishedAt`, `durationMs`, `errorCode`, `errorMessage`, `executions[]` (`role`, `status`, `outcome`, `durationMs`) |
| GET | `/api/scans/{scanId}/report` | `faultline.report/v1` JSON as an attachment |
| GET | `/api/artifacts/{artifactId}` | The stored PNG. `ETag` and `x-faultline-sha256` carry the content hash. `?download=1` adds `Content-Disposition: attachment` |

## `faultline.report/v1`

Built by `buildReport` in `packages/shared/src/report.ts` from persisted rows only.

```jsonc
{
  "schema": "faultline.report/v1",
  "generatedAt": "2026-10-24T15:08:36.000Z",
  "generator": { "name": "faultline", "version": "0.1.0" },
  "project": { "id": "…", "name": "…", "origin": "http://localhost:4600" },
  "scan": {
    "id": "…", "targetUrl": "http://localhost:4600/",
    "scenario": { "kind": "resource-block", "resourceTypes": ["stylesheet"], "scope": "all", "abortErrorCode": "failed", "viewport": "desktop" },
    "scenarioSummary": "Abort stylesheets",
    "status": "completed", "createdAt": "…", "startedAt": "…", "finishedAt": "…", "durationMs": 1410,
    "errorCode": null, "errorMessage": null,
    "environment": { "browserName": "chromium", "browserVersion": "156.0.8078.4", "playwrightVersion": "1.64.1", "chromiumSandbox": true, "deploymentMode": "local", "egress": { … }, "limits": { … }, … }
  },
  "executions": [
    {
      "role": "baseline", "label": "Normal conditions",
      "status": "completed", "outcome": "loaded", "outcomeLabel": "Page loaded",
      "conditions": { "network": "normal", "steps": [ … ], "serviceWorkers": "block", "notes": [ … ] },
      "requestedUrl": "…", "finalUrl": "…", "httpStatus": 200, "pageTitle": "…",
      "startedAt": "…", "finishedAt": "…", "durationMs": 670,
      "browserName": "chromium", "browserVersion": "…", "userAgent": "…", "viewport": { "width": 1366, "height": 900, "isMobile": false },
      "navigationError": null,
      "summary": { "totalRequests": 6, "failedRequests": 0, "httpErrors": 1, "consoleErrors": 1, "pageErrors": 0, "intentionallyBlocked": 0, "policyBlocked": 0, "droppedEvents": {}, "requestBudgetExhausted": false, "transferredBytes": 9576 },
      "events": [ { "seq": 0, "kind": "lifecycle", "severity": "info", "occurredAt": "…", "offsetMs": 3, "message": "…", "url": null, … } ],
      "screenshot": { "id": "…", "kind": "screenshot", "contentType": "image/png", "byteSize": 45812, "sha256": "d876d2…", "width": 1366, "height": 900, "createdAt": "…" }
    },
    { "role": "fault", … }
  ],
  "comparison": { "facts": [ { "id": "intentional-blocks", "statement": "…", "tone": "neutral" } ], "consoleErrorsOnlyInFault": [ … ], "consoleErrorsOnlyInBaseline": [ … ] },
  "interpretation": { "canConclude": [ … ], "cannotConclude": [ … ] },
  "integrity": { "note": "…" }
}
```

Event kinds: `lifecycle`, `navigation`, `console`, `page_error`, `request_failed`, `http_error`, `fault_injected`, `policy_block`. Execution outcomes: `loaded`, `loaded_with_http_error`, `navigation_timeout`, `navigation_failed`, `blocked_by_policy`, `left_authorized_scope`, `too_many_redirects`, `browser_error`.

To verify a screenshot: download `/api/artifacts/{id}` and compare `sha256sum` with `executions[].screenshot.sha256`.
