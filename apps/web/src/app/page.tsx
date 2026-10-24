import { redirect } from "next/navigation";
import { getCurrentOperator } from "@/lib/auth/session";

export default async function Home() {
  redirect((await getCurrentOperator()) ? "/projects" : "/login");
}
