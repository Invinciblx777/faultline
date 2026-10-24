import { HeadBucketCommand } from "@aws-sdk/client-s3";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DevinConnectionTest } from "@/components/repair/devin-connection-test";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { PageHeader } from "@/design/components/page-header";
import { ToneChip } from "@/design/components/status";
import { requireOperator } from "@/lib/auth/dal";
import { getQueueCounts, getWorkerStatus } from "@/lib/data/queries";
import { getEnv } from "@/lib/env";
import { getDevinConfig } from "@/lib/integrations";
import { formatDateTime, formatRelative } from "@/lib/format";
import { getStorage } from "@/lib/storage";
import { Card, CardDescription, CardTitle } from "@/design/components";

export const metadata: Metadata = { title: "Settings" };

async function storageReachable(): Promise<{ ok: boolean; detail: string }> {
  const storage = getStorage();
  try {
    await storage.client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
    return { ok: true, detail: "Bucket reachable" };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    return { ok: false, detail: status === 404 ? "Bucket does not exist yet (the worker creates it on start)" : "Storage is not reachable" };
  }
}

const FUTURE = [
  { name: "Anthropic Claude", area: "Evidence-backed analysis" },
  { name: "Google Gemini", area: "Evidence-backed analysis" },
  { name: "OpenAI", area: "Evidence-backed analysis" },
  { name: "OpenAI-compatible local inference", area: "Evidence-backed analysis" },
];

export default async function SettingsPage() {
  const operator = await requireOperator();
  const env = getEnv();
  const [workers, queue, storage] = await Promise.all([getWorkerStatus(), getQueueCounts(), storageReachable()]);
  const theme = (await cookies()).get("faultline_theme")?.value ?? "dark";
  const devin = getDevinConfig();
  const endpointHost = env.S3_ENDPOINT ? new URL(env.S3_ENDPOINT).host : "AWS S3 (default endpoint)";

  return (
    <>
      <PageHeader title="Settings" description="Live configuration status of this FAULTLINE server. Server settings are changed in its environment file, not here." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card tier="low">
          <CardTitle>Account and appearance</CardTitle>
          <CardDescription className="mb-4">Signed in as {operator.username}.</CardDescription>
          <ThemeToggle initial={theme} />
        </Card>

        <Card tier="low">
          <div className="mb-1 flex items-center justify-between gap-2">
            <CardTitle>Scan workers</CardTitle>
            <ToneChip tone={workers.online.length ? "success" : "failure"} label={workers.online.length ? `${workers.online.length} online` : "Offline"} />
          </div>
          <CardDescription className="mb-4">
            <span className="tabular">{queue.queued}</span> queued, <span className="tabular">{queue.running}</span> running.
          </CardDescription>
          {workers.online.length ? (
            <ul className="flex flex-col gap-0.5 text-sm">
              {workers.online.map((w) => (
                <li key={w.id} className="rounded-sm bg-surface-container px-4 py-3 first:rounded-t-lg last:rounded-b-lg">
                  <span className="block font-medium">{w.id}</span>
                  <span className="block text-on-surface-variant">
                    Chromium {w.browserVersion ?? "unknown"} · Playwright {w.playwrightVersion ?? "unknown"} · concurrency {w.concurrency} · heartbeat{" "}
                    {formatRelative(w.lastHeartbeatAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-on-surface-variant">
              {workers.lastSeen ? `Last heartbeat ${formatDateTime(workers.lastSeen.lastHeartbeatAt)}.` : "No worker has connected to this database."} Start one with{" "}
              <code className="font-mono text-on-surface">pnpm dev:worker</code>.
            </p>
          )}
        </Card>

        <Card tier="low" className="lg:col-span-2">
          <CardTitle>Scan authorization</CardTitle>
          <CardDescription className="mb-4">Only these origins can be added as projects and scanned. Edit FAULTLINE_SCAN_ALLOWLIST and restart to change them.</CardDescription>
          <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-on-surface-variant">Deployment mode</dt>
            <dd>
              {env.FAULTLINE_DEPLOYMENT_MODE === "local"
                ? "Local, operator-only. Allowlisted private or loopback origins may be scanned."
                : "Public. Non-public network addresses are always refused."}
            </dd>
            <dt className="text-on-surface-variant">Subresources</dt>
            <dd>
              {env.FAULTLINE_SUBRESOURCE_POLICY === "public"
                ? "Pages may load resources from public internet hosts on ports 80 and 443."
                : "Every browser connection must target an allowlisted origin."}
            </dd>
            <dt className="text-on-surface-variant">Always refused</dt>
            <dd>Cloud metadata endpoints, and private, loopback, or link-local addresses that are not explicitly allowlisted.</dd>
            <dt className="text-on-surface-variant">Allowlist</dt>
            <dd>
              {env.FAULTLINE_SCAN_ALLOWLIST.length ? (
                <ul className="flex flex-wrap gap-2">
                  {env.FAULTLINE_SCAN_ALLOWLIST.map((e) => (
                    <li key={e.source} className="rounded-sm bg-surface-high px-2.5 py-1">
                      {e.source}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-failure">Empty. No scans can run.</span>
              )}
            </dd>
          </dl>
        </Card>

        <Card tier="low">
          <div className="mb-1 flex items-center justify-between gap-2">
            <CardTitle>Artifact storage</CardTitle>
            <ToneChip tone={storage.ok ? "success" : "failure"} label={storage.detail} />
          </div>
          <CardDescription>
            S3-compatible bucket <span className="text-on-surface">{getStorage().bucket}</span> at {endpointHost}. The bucket stays private; screenshots are served only to signed-in operators.
          </CardDescription>
        </Card>

        <Card tier="low">
          <CardTitle>Database</CardTitle>
          <CardDescription>PostgreSQL is connected (this page was rendered from it). Scan jobs use the pg-boss queue in the same database.</CardDescription>
        </Card>

        <Card tier="low">
          <div className="mb-1 flex items-center justify-between gap-2">
            <CardTitle>Devin API v3</CardTitle>
            <ToneChip tone={devin.configured ? "success" : "unavailable"} label={devin.configured ? "Configured" : "Not configured"} />
          </div>
          <CardDescription className="mb-4">
            {devin.configured
              ? `Service-user key and organization ${devin.orgId} are set on the server. Sessions are created only after an approver approves a repair request.`
              : `${devin.reason} Set DEVIN_API_KEY (a cog_ service-user key) and DEVIN_ORG_ID in the server environment. Repair requests can still be prepared, but not approved.`}
          </CardDescription>
          <dl className="mb-4 grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-on-surface-variant">Approvers</dt>
            <dd>{env.FAULTLINE_REPAIR_APPROVERS.length ? env.FAULTLINE_REPAIR_APPROVERS.join(", ") : <span className="text-failure">None (FAULTLINE_REPAIR_APPROVERS is empty)</span>}</dd>
          </dl>
          <DevinConnectionTest disabled={!devin.configured} />
        </Card>

        <Card tier="low">
          <div className="mb-1 flex items-center justify-between gap-2">
            <CardTitle>GitHub</CardTitle>
            <ToneChip tone={env.GITHUB_TOKEN ? "success" : "unavailable"} label={env.GITHUB_TOKEN ? "Token set" : "No token"} />
          </div>
          <CardDescription className="mb-4">
            FAULTLINE reads repositories, branches, commits, and pull requests to confirm what Devin reports, and downloads exact commits for verification. It never pushes, merges, or
            comments. {env.GITHUB_TOKEN ? "" : "Without GITHUB_TOKEN only public repositories can be read, with low rate limits."}
          </CardDescription>
          <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-on-surface-variant">Authorized repositories</dt>
            <dd>
              {env.FAULTLINE_REPAIR_REPOSITORIES.length ? (
                <ul className="flex flex-wrap gap-2">
                  {env.FAULTLINE_REPAIR_REPOSITORIES.map((r) => (
                    <li key={r} className="rounded-sm bg-surface-high px-2.5 py-1">
                      {r}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-failure">None (FAULTLINE_REPAIR_REPOSITORIES is empty)</span>
              )}
            </dd>
          </dl>
        </Card>

        <Card tier="low" className="lg:col-span-2">
          <CardTitle>Other integrations</CardTitle>
          <CardDescription className="mb-4">
            Not available in this release. Their contracts are documented in <code className="font-mono">packages/shared/src/contracts</code>. When added, AI output will be labeled as
            hypotheses.
          </CardDescription>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FUTURE.map((f) => (
              <li key={f.name} className="flex flex-col gap-2 rounded-lg border-2 border-dashed border-outline-variant bg-surface-container px-4 py-3">
                <span className="text-sm font-medium">{f.name}</span>
                <span className="text-xs text-on-surface-variant">{f.area}</span>
                <ToneChip tone="unavailable" label="Unavailable" className="w-fit" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
