import { Ban, FileJson, FileText, RotateCcw, SplitSquareHorizontal } from "lucide-react";
import { isTerminalScanStatus, type ScanStatus } from "@faultline/shared";
import { cancelScanAction, rerunScanAction } from "@/app/actions/scans";
import { Button, buttonClasses, LinkButton } from "@/components/ui/button";

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
      ) : (
        <form action={cancelScanAction}>
          <input type="hidden" name="scanId" value={scanId} />
          <Button type="submit" variant="danger" disabled={cancelRequested} icon={<Ban aria-hidden />}>
            {cancelRequested ? "Cancelling…" : "Cancel scan"}
          </Button>
        </form>
      )}
    </>
  );
}
