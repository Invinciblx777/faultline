"use client";

import { Check } from "lucide-react";
import { useActionState, useState } from "react";
import { createProjectAction, type ProjectFormState } from "@/app/actions/projects";
import { Field, TextArea, TextInput } from "@/design/components/field";
import { cn } from "@/lib/cn";
import { FilledButton } from "@/design/components";

export function ProjectForm({ allowlist }: { allowlist: Array<{ source: string; wildcard: boolean }> }) {
  const [state, action, pending] = useActionState<ProjectFormState, FormData>(createProjectAction, {});
  const exact = allowlist.filter((e) => !e.wildcard);
  const [origin, setOrigin] = useState(state.values?.origin ?? exact[0]?.source ?? "");
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-6" noValidate>
      <Field label="Project name" error={state.fieldErrors?.name}>
        {({ id, describedBy, invalid }) => (
          <TextInput id={id} name="name" required maxLength={80} defaultValue={state.values?.name} aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>
      <Field
        label="Website origin"
        hint="Scheme, host, and optional port. It must match the server's scan allowlist."
        error={state.fieldErrors?.origin}
      >
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            name="origin"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://staging.example.com"
            required
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      {allowlist.length ? (
        <div className="-mt-3 flex flex-wrap gap-2" aria-label="Authorized origins">
          {allowlist.map((entry) =>
            entry.wildcard ? (
              <span key={entry.source} className="type-label inline-flex h-8 items-center rounded-sm border border-outline-variant px-3 text-on-surface-variant">
                {entry.source}
              </span>
            ) : (
              <button
                key={entry.source}
                type="button"
                onClick={() => setOrigin(entry.source)}
                aria-pressed={origin === entry.source}
                className={cn(
                  "type-label inline-flex h-8 items-center gap-1.5 rounded-sm border px-3 transition-colors",
                  origin === entry.source ? "border-transparent bg-primary-container text-on-primary-container" : "border-outline text-on-surface hover:bg-surface-high",
                )}
              >
                {origin === entry.source ? <Check aria-hidden className="size-4" /> : null}
                {entry.source}
              </button>
            ),
          )}
        </div>
      ) : null}
      <Field label="Notes (optional)" error={state.fieldErrors?.description}>
        {({ id, describedBy }) => <TextArea id={id} name="description" maxLength={500} defaultValue={state.values?.description} aria-describedby={describedBy} />}
      </Field>
      {state.error && !state.fieldErrors ? (
        <p role="alert" className="rounded-md bg-failure-container px-4 py-3 text-sm text-on-failure-container">
          {state.error}
        </p>
      ) : null}
      <div>
        <FilledButton type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create project"}
        </FilledButton>
      </div>
    </form>
  );
}
