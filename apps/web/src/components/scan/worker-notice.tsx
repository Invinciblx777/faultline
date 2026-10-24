import { ServerOff } from "lucide-react";
import { getWorkerStatus } from "@/lib/data/queries";
import { formatRelative } from "@/lib/format";

/** Truthful notice when no worker is heartbeating: new scans would wait in the queue. */
export async function WorkerNotice() {
  const { online, lastSeen } = await getWorkerStatus();
  if (online.length) return null;
  return (
    <div role="status" className="mb-6 flex gap-3 rounded-lg border border-dashed border-incomplete px-4 py-3 text-sm">
      <ServerOff aria-hidden className="mt-0.5 size-5 shrink-0 text-incomplete" />
      <p>
        <span className="font-medium text-on-surface">No scan worker is online.</span>{" "}
        <span className="text-on-surface-variant">
          Scans will wait in the queue until one starts ({lastSeen ? `last heartbeat ${formatRelative(lastSeen.lastHeartbeatAt)}` : "no worker has ever connected"}). Start it with{" "}
          <code className="font-mono text-on-surface">pnpm dev:worker</code>.
        </span>
      </p>
    </div>
  );
}
