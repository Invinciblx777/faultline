import "server-only";
import { DevinClient, devinConfigFromEnv, GitHubClient } from "@faultline/shared/integrations";
import { getDb } from "./db";
import { getEnv } from "./env";
import type { RepairServiceDeps } from "./services/repairs";

/** Devin and GitHub clients built from server-side configuration only. Keys never reach the browser. */
export function getDevinConfig() {
  return devinConfigFromEnv(process.env);
}

export function getRepairDeps(): RepairServiceDeps {
  const env = getEnv();
  const config = getDevinConfig();
  return {
    db: getDb(),
    repositoryAllowlist: env.FAULTLINE_REPAIR_REPOSITORIES,
    approvers: env.FAULTLINE_REPAIR_APPROVERS,
    devin: config.configured ? new DevinClient({ apiKey: config.apiKey, orgId: config.orgId, baseUrl: config.baseUrl }) : null,
    devinUnavailable: config.configured ? null : config.reason,
    github: new GitHubClient({ token: env.GITHUB_TOKEN ?? null }),
  };
}
