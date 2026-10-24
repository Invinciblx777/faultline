"use server";

import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { createJourney, reviseJourney } from "@/lib/services/journeys";

export interface JourneyFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

function definitionFrom(form: FormData): unknown {
  try {
    return JSON.parse(String(form.get("definition") ?? ""));
  } catch {
    return null;
  }
}

export async function saveJourneyAction(_prev: JourneyFormState, form: FormData): Promise<JourneyFormState> {
  const operator = await requireOperator();
  const definition = definitionFrom(form);
  if (definition === null) return { error: "The journey could not be read. Reload the page and try again." };
  const journeyId = String(form.get("journeyId") ?? "");
  const projectId = String(form.get("projectId") ?? "");
  const result = journeyId
    ? await reviseJourney({ db: getDb() }, operator, { journeyId, definition })
    : await createJourney({ db: getDb() }, operator, { projectId, definition });
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  redirect(`/projects/${projectId}/journeys/${result.journeyId}`);
}
