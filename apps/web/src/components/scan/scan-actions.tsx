import { Ban, FileJson, FileText, RotateCcw, SplitSquareHorizontal } from "lucide-react";
import { isTerminalScanStatus, type ScanStatus } from "@faultline/shared";
import { cancelScanAction, rerunScanAction } from "@/app/actions/scans";
import { buttonStyle, ErrorButton, LinkButton, TextButton } from "@/design/components";

export function ScanActions({ scanId, status, authorized, cancelRequested }: { scanId: string; status: ScanStatus; authorized: boolean; cancelRequested: boolean }) {
  const terminal = isTerminalScanStatus(status);
  return (
    <>
      {terminal ? (
        <>
          <LinkButton href={`/scans/${scanId}/split`} icon={<SplitSquareHorizontal aria-hidden />}>
            Reality Split
          </LinkButton>
          <LinkButton href={`/scans/${scanId}/report`} variant="tonal" icon={<FileText aria-hidden />}>
            Report
          </LinkButton>
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
      ) : (
        <form action={cancelScanAction}>
          <input type="hidden" name="scanId" value={scanId} />
          <ErrorButton type="submit" disabled={cancelRequested} icon={<Ban aria-hidden />}>
            {cancelRequested ? "Cancelling…" : "Cancel scan"}
          </ErrorButton>
        </form>
      )}
    </>
  );
}
