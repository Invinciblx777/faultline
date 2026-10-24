import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/shell/logo";
import { getCurrentOperator } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const VERBS = [
  { word: "Break it.", tone: "text-fault" },
  { word: "Understand it.", tone: "text-on-surface" },
  { word: "Fix it.", tone: "text-on-surface" },
  { word: "Prove it.", tone: "text-normal" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentOperator()) redirect("/projects");
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      <section className="relative flex flex-col justify-between gap-12 overflow-hidden bg-surface-low px-6 pt-[calc(2rem+env(safe-area-inset-top))] pb-10 sm:px-12 lg:py-14">
        <div className="flex items-center gap-3">
          <LogoMark className="size-10" />
          <span className="type-display text-2xl">Faultline</span>
        </div>
        <div>
          <p className="type-display text-[3.25rem] leading-[0.95] sm:text-[4.5rem] xl:text-[5.5rem]">
            {VERBS.map((v) => (
              <span key={v.word} className={`block ${v.tone}`}>
                {v.word}
              </span>
            ))}
          </p>
          <p className="mt-8 max-w-[52ch] text-lg text-on-surface-variant">
            Run your website in a real browser under normal conditions, then again with resources failing or the network gone, and
            compare what actually happened, side by side.
          </p>
        </div>
        <p className="max-w-[60ch] text-sm text-on-surface-variant">
          Self-hosted, operator-only. Scans run only against origins your administrator has authorized.
        </p>
      </section>
      <section className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <h1 className="type-headline text-3xl">Sign in</h1>
          <p className="mt-2 mb-8 text-on-surface-variant">Use the operator account created on this server.</p>
          <LoginForm next={next} />
          <p className="mt-8 text-sm text-on-surface-variant">
            No account yet? Run <code className="rounded-xs bg-surface-high px-1.5 py-0.5 font-mono text-[0.8125rem]">pnpm operator:create &lt;name&gt;</code> on
            the server.
          </p>
        </div>
      </section>
    </main>
  );
}
