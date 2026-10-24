import "server-only";
import { redirect } from "next/navigation";
import { getCurrentOperator, type CurrentOperator } from "./session";

/** Data-access-layer guard: every protected page, action, and route calls this. */
export async function requireOperator(): Promise<CurrentOperator> {
  const operator = await getCurrentOperator();
  if (!operator) redirect("/login");
  return operator;
}
