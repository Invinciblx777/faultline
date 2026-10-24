"use server";

import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { createProject } from "@/lib/services/projects";

export interface ProjectFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: { name: string; origin: string; description: string };
}

export async function createProjectAction(_prev: ProjectFormState, form: FormData): Promise<ProjectFormState> {
  const operator = await requireOperator();
  const values = {
    name: String(form.get("name") ?? ""),
    origin: String(form.get("origin") ?? ""),
    description: String(form.get("description") ?? ""),
  };
  const result = await createProject({ db: getDb(), allowlist: getEnv().FAULTLINE_SCAN_ALLOWLIST }, operator, values);
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors, values };
  redirect(`/projects/${result.projectId}`);
}
