import { Ban, FileJson, RotateCcw } from "lucide-react";
import { isTerminalScanStatus, type ScanStatus } from "@faultline/shared";
import { cancelScanAction, rerunScanAction } from "@/app/actions/scans";
import { buttonStyle, ErrorButton, TextButton } from "@/design/components";

export function AnalysisActions({ scanId, status, authorized, cancelRequested }: { scanId: string; status: ScanStatus; authorized: boolean; cancelRequested: boolean }) {
  if (!isTerminalScanStatus(status)) {
    return (
      <form action={cancelScanAction}>
        <input type="hidden" name="scanId" value={scanId} />
        <ErrorButton type="submit" disabled={cancelRequested} icon={<Ban aria-hidden />}>
          {cancelRequested ? "Cancelling…" : "Cancel analysis"}
        </ErrorButton>
      </form>
    );
  }
  return (
    <>
      <a href={`/api/scans/${scanId}/report`} download className={buttonStyle("outlined")}>
        <FileJson aria-hidden />
        Export JSON
      </a>
      {authorized ? (
        <form action={rerunScanAction}>
          <input type="hidden" name="scanId" value={scanId} />
          <TextButton type="submit" icon={<RotateCcw aria-hidden />}>
            Run again
          </TextButton>
        </form>
      ) : null}
    </>
  );
}
