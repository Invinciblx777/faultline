"use client";

import { PlugZap } from "lucide-react";
import { useActionState } from "react";
import { testDevinConnectionAction, type ConnectionTestState } from "@/app/actions/repairs";
import { cn } from "@/lib/cn";
import { OutlinedButton } from "@/design/components";

export function DevinConnectionTest({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<ConnectionTestState>(testDevinConnectionAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <div>
        <OutlinedButton className="min-h-10 px-4" type="submit" icon={<PlugZap aria-hidden />} disabled={disabled || pending}>
          {pending ? "Testing…" : "Test Devin connection"}
        </OutlinedButton>
      </div>
      {state.message ? (
        <p role="status" className={cn("text-sm", state.ok ? "text-success" : "text-failure")}>
          {state.message}
        </p>
      ) : (
        <p className="text-xs text-on-surface-variant">Calls GET /v3/self. No session is created and no credits are used.</p>
      )}
    </form>
  );
}
