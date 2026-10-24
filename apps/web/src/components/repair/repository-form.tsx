"use client";

import { useActionState } from "react";
import { linkRepositoryAction, type RepairFormState } from "@/app/actions/repairs";
import { Field, TextInput } from "@/design/components/field";
import { FilledButton } from "@/design/components";

interface Defaults {
  owner: string;
  name: string;
  baseBranch: string;
  appDir: string;
  entry: string;
  portEnv: string;
  extraPortEnvs: string;
  hostEnv: string;
}

/** Links a GitHub repository. No credentials are entered here: GitHub and Devin access come from server configuration. */
export function RepositoryForm({ projectId, defaults, authorized }: { projectId: string; defaults: Defaults; authorized: string[] }) {
  const [state, action, pending] = useActionState<RepairFormState, FormData>(linkRepositoryAction, {});
  const err = (k: string) => state.fieldErrors?.[k] ?? state.fieldErrors?.[`recipe.${k}`];
  const text = (name: keyof Defaults, label: string, hint?: string, placeholder?: string) => (
    <Field label={label} hint={hint} error={err(name)}>
      {({ id, describedBy, invalid }) => (
        <TextInput id={id} name={name} defaultValue={defaults[name]} placeholder={placeholder} autoCapitalize="none" spellCheck={false} aria-describedby={describedBy} aria-invalid={invalid} />
      )}
    </Field>
  );
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-4 sm:grid-cols-2">
        {text("owner", "GitHub owner", undefined, "acme")}
        {text("name", "Repository", authorized.length ? `Authorized on this server: ${authorized.join(", ")}` : "No repositories are authorized (FAULTLINE_REPAIR_REPOSITORIES is empty).", "shop")}
        {text("baseBranch", "Base branch", "Devin opens pull requests against this branch.")}
        {text("appDir", "App directory (optional)", "Relative path inside the repository, if the app is not at its root.")}
      </div>
      <fieldset className="flex flex-col gap-4 rounded-lg border border-outline-variant p-4">
        <legend className="type-label px-1">How FAULTLINE runs a commit for verification</legend>
        <p className="text-sm text-on-surface-variant">
          A Node.js server with no dependencies, started as <code className="font-mono">node &lt;entry&gt;</code> inside a locked-down container with no network access beyond its own ports. Shell commands are not accepted.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {text("entry", "Entry file", "For example server.mjs", "server.mjs")}
          {text("portEnv", "Port variable", "Environment variable the server reads its port from.")}
          {text("extraPortEnvs", "Extra port variables (optional)", "Comma-separated, for servers that listen on a second port.")}
          {text("hostEnv", "Host variable (optional)", "Set to 0.0.0.0 inside the container if the server binds to localhost by default.")}
        </div>
      </fieldset>
      {state.error ? (
        <p role="alert" className="rounded-md bg-failure-container px-4 py-3 text-sm text-on-failure-container">
          {state.error}
        </p>
      ) : null}
      <div>
        <FilledButton type="submit" disabled={pending}>
          {pending ? "Checking GitHub and Devin…" : "Save and check connections"}
        </FilledButton>
      </div>
    </form>
  );
}
