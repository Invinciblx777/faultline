"use client";

import { LogIn } from "lucide-react";
import { useActionState } from "react";
import { login, type LoginState } from "@/app/actions/auth";
import { Field, TextInput } from "@/design/components/field";
import { FilledButton } from "@/design/components";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="Username">
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            defaultValue={state.username}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      <Field label="Password">
        {({ id, describedBy }) => (
          <TextInput id={id} name="password" type="password" autoComplete="current-password" required aria-describedby={describedBy} />
        )}
      </Field>
      {state.error ? (
        <p role="alert" className="rounded-md bg-failure-container px-4 py-3 text-sm text-on-failure-container">
          {state.error}
        </p>
      ) : null}
      <FilledButton type="submit" disabled={pending} icon={<LogIn aria-hidden />}>
        {pending ? "Signing in…" : "Sign in"}
      </FilledButton>
    </form>
  );
}
