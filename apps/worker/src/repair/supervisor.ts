import { claimNextVerification, failStaleVerifications, queuedRepairs, repairsDueForSync } from "@faultline/db";
import { recoverSubmissions, submitRepair, syncRepair, type RepairAgentDeps } from "./devin-agent";
import { runVerification, type VerificationDeps } from "./verification-runner";

/** A verification whose worker has not reported for this long is closed as interrupted. */
export const VERIFICATION_STALE_AFTER_MS = 90_000;

export interface SupervisorOptions {
  agent: RepairAgentDeps;
  verification: VerificationDeps;
  pollIntervalMs: number;
  tickMs?: number;
}

/**
 * Drives the repair loop from stored state, so nothing depends on memory
 * surviving a restart:
 *   - approved requests are submitted to Devin once (claim, then call);
 *   - unconfirmed submissions are recovered by tag lookup;
 *   - active sessions and their pull requests are polled at a fixed interval, one at a time;
 *   - queued verifications run one at a time, separately from polling.
 */
export function startRepairSupervisor(options: SupervisorOptions) {
  const { agent, verification } = options;
  const tickMs = options.tickMs ?? 3_000;
  let agentBusy = false;
  let verifying: Promise<void> | null = null;
  let stopped = false;

  const agentTick = async () => {
    if (agentBusy || stopped) return;
    agentBusy = true;
    try {
      await recoverSubmissions(agent);
      for (const repair of await queuedRepairs(agent.db)) {
        if (stopped) break;
        await submitRepair(agent, repair.id);
      }
      for (const repair of await repairsDueForSync(agent.db, options.pollIntervalMs, 5)) {
        if (stopped) break;
        await syncRepair(agent, repair);
      }
    } catch (error) {
      agent.log("repair supervisor tick failed", { error: (error as Error).message });
    } finally {
      agentBusy = false;
    }
  };

  const verificationTick = async () => {
    if (verifying || stopped) return;
    try {
      const interrupted = await failStaleVerifications(verification.db, VERIFICATION_STALE_AFTER_MS);
      if (interrupted.length) verification.log("closed interrupted verifications", { runIds: interrupted.map((r) => r.id) });
      const run = await claimNextVerification(verification.db, verification.workerId);
      if (!run) return;
      verification.log("verification claimed", { runId: run.id, candidateSha: run.candidateSha });
      verifying = runVerification(verification, run)
        .catch((error: Error) => verification.log("verification crashed", { runId: run.id, error: error.message }))
        .finally(() => {
          verifying = null;
        });
    } catch (error) {
      verification.log("verification supervisor tick failed", { error: (error as Error).message });
    }
  };

  const agentTimer = setInterval(() => void agentTick(), tickMs);
  const verificationTimer = setInterval(() => void verificationTick(), tickMs);
  void agentTick();
  void verificationTick();

  return {
    async stop() {
      stopped = true;
      clearInterval(agentTimer);
      clearInterval(verificationTimer);
      // A running verification is left to the stale sweep of the next worker; its containers are removed on startup.
    },
  };
}
