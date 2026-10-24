import { Ban, FileJson, RotateCcw } from "lucide-react";
import { isTerminalScanStatus, type ScanStatus } from "@faultline/shared";
import { cancelScanAction, rerunScanAction } from "@/app/actions/scans";
import { Button, buttonClasses } from "@/components/ui/button";

export function AnalysisActions({ scanId, status, authorized, cancelRequested }: { scanId: string; status: ScanStatus; authorized: boolean; cancelRequested: boolean }) {
  if (!isTerminalScanStatus(status)) {
    return (
      <form action={cancelScanAction}>
        <input type="hidden" name="scanId" value={scanId} />
        <Button type="submit" variant="danger" disabled={cancelRequested} icon={<Ban aria-hidden />}>
          {cancelRequested ? "Cancelling…" : "Cancel analysis"}
        </Button>
      </form>
    );
  }
  return (
    <>
      <a href={`/api/scans/${scanId}/report`} download className={buttonClasses("outlined", "md")}>
        <FileJson aria-hidden />
        Export JSON
      </a>
      {authorized ? (
        <form action={rerunScanAction}>
          <input type="hidden" name="scanId" value={scanId} />
          <Button type="submit" variant="text" icon={<RotateCcw aria-hidden />}>
            Run again
          </Button>
        </form>
      ) : null}
    </>
  );
}
