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
import { ListGroup, ListItem } from "@/design/components";

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

  const tags = (items: string[]) => (
    <span className="mt-1 flex flex-wrap gap-2">
      {items.map((x) => (
        <span key={x} className="md-label-medium rounded-sm bg-surface-high px-2.5 py-1 text-on-surface">
          {x}
        </span>
      ))}
    </span>
  );

  return (
    <>
      <PageHeader
        title="Settings"
        description="Live configuration status of this FAULTLINE server. Server settings are changed in its environment file, not here."
      />
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <Section id="operator" title="Operator">
          <ListItem headline="Signed in" supporting={operator.username} />
          <ListItem headline="Appearance" supporting="Color theme for this browser" trailing={<ThemeToggle initial={theme} />} className="flex-wrap" />
        </Section>

        <Section id="repair-providers" title="Repair providers">
          <ListItem
            headline={<h3 className="md-title-medium">Devin API v3</h3>}
            supporting={
              devin.configured
                ? `Service-user key and organization ${devin.orgId} are set on the server. Sessions are created only after an approver approves a repair request.`
                : `${devin.reason} Set DEVIN_API_KEY (a cog_ service-user key) and DEVIN_ORG_ID in the server environment. Repair requests can still be prepared, but not approved.`
            }
            trailing={<ToneChip tone={devin.configured ? "success" : "unavailable"} label={devin.configured ? "Configured" : "Not configured"} />}
          />
          <ListItem
            headline="Approvers"
            supporting={
              env.FAULTLINE_REPAIR_APPROVERS.length ? (
                env.FAULTLINE_REPAIR_APPROVERS.join(", ")
              ) : (
                <span className="text-error">None (FAULTLINE_REPAIR_APPROVERS is empty)</span>
              )
            }
          />
          <ListItem headline="Connection" supporting={<DevinConnectionTest disabled={!devin.configured} />} />
          {FUTURE.map((f) => (
            <ListItem
              key={f.name}
              headline={f.name}
              supporting={`${f.area}. Not available in this release.`}
              trailing={<ToneChip tone="unavailable" label="Unavailable" />}
            />
          ))}
        </Section>

        <Section id="repositories" title="Repositories">
          <ListItem
            headline={<h3 className="md-title-medium">GitHub</h3>}
            supporting={`FAULTLINE reads repositories, branches, commits, and pull requests to confirm what Devin reports, and downloads exact commits for verification. It never pushes, merges, or comments.${env.GITHUB_TOKEN ? "" : " Without GITHUB_TOKEN only public repositories can be read, with low rate limits."}`}
            trailing={<ToneChip tone={env.GITHUB_TOKEN ? "success" : "unavailable"} label={env.GITHUB_TOKEN ? "Token set" : "No token"} />}
          />
          <ListItem
            headline="Authorized repositories"
            supporting={
              env.FAULTLINE_REPAIR_REPOSITORIES.length ? (
                tags(env.FAULTLINE_REPAIR_REPOSITORIES)
              ) : (
                <span className="text-error">None (FAULTLINE_REPAIR_REPOSITORIES is empty)</span>
              )
            }
          />
        </Section>

        <Section id="system" title="System">
          <ListItem
            headline="Scan workers"
            supporting={
              <>
                <span className="tabular">{queue.queued}</span> queued, <span className="tabular">{queue.running}</span> running.{" "}
                {workers.online.length ? (
                  workers.online.map((w) => (
                    <span key={w.id} className="mt-1 block">
                      <span className="text-on-surface">{w.id}</span> · Chromium {w.browserVersion ?? "unknown"} · Playwright {w.playwrightVersion ?? "unknown"}{" "}
                      · concurrency {w.concurrency} · heartbeat {formatRelative(w.lastHeartbeatAt)}
                    </span>
                  ))
                ) : (
                  <>
                    {workers.lastSeen ? `Last heartbeat ${formatDateTime(workers.lastSeen.lastHeartbeatAt)}.` : "No worker has connected to this database."}{" "}
                    Start one with <code className="font-mono text-on-surface">pnpm dev:worker</code>.
                  </>
                )}
              </>
            }
            trailing={
              <ToneChip tone={workers.online.length ? "success" : "failure"} label={workers.online.length ? `${workers.online.length} online` : "Offline"} />
            }
          />
          <ListItem
            headline="Artifact storage"
            supporting={
              <>
                S3-compatible bucket <span className="text-on-surface">{getStorage().bucket}</span> at {endpointHost}. The bucket stays private; screenshots are
                served only to signed-in operators.
              </>
            }
            trailing={<ToneChip tone={storage.ok ? "success" : "failure"} label={storage.detail} />}
          />
          <ListItem
            headline="Database"
            supporting="PostgreSQL is connected (this page was rendered from it). Scan jobs use the pg-boss queue in the same database."
          />
        </Section>

        <Section id="scan-authorization" title="Scan authorization" className="lg:col-span-2">
          <ListItem
            headline="Deployment mode"
            supporting={
              env.FAULTLINE_DEPLOYMENT_MODE === "local"
                ? "Local, operator-only. Allowlisted private or loopback origins may be scanned."
                : "Public. Non-public network addresses are always refused."
            }
          />
          <ListItem
            headline="Subresources"
            supporting={
              env.FAULTLINE_SUBRESOURCE_POLICY === "public"
                ? "Pages may load resources from public internet hosts on ports 80 and 443."
                : "Every browser connection must target an allowlisted origin."
            }
          />
          <ListItem
            headline="Always refused"
            supporting="Cloud metadata endpoints, and private, loopback, or link-local addresses that are not explicitly allowlisted."
          />
          <ListItem
            headline="Allowlist"
            supporting={
              env.FAULTLINE_SCAN_ALLOWLIST.length ? (
                <>
                  Only these origins can be added as projects and scanned. Edit FAULTLINE_SCAN_ALLOWLIST and restart to change them.
                  {tags(env.FAULTLINE_SCAN_ALLOWLIST.map((e) => e.source))}
                </>
              ) : (
                <span className="text-error">Empty. No scans can run.</span>
              )
            }
          />
        </Section>
      </div>
    </>
  );
}

function Section({ id, title, className, children }: { id: string; title: string; className?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className={className}>
      <h2 id={`${id}-title`} className="md-title-medium mb-3 px-4 text-primary">
        {title}
      </h2>
      <ListGroup>{children}</ListGroup>
    </section>
  );
}
