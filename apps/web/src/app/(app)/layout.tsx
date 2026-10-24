import { LogOut } from "lucide-react";
import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { LogoMark } from "@/components/shell/logo";
import { BottomNavigation, NavigationRail } from "@/components/shell/navigation";
import { requireOperator } from "@/lib/auth/dal";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const operator = await requireOperator();
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-24 shrink-0 flex-col items-center gap-8 border-r border-outline-variant bg-surface-low py-6 md:flex">
        <Link href="/projects" aria-label="Faultline home" className="rounded-lg p-1">
          <LogoMark className="size-9" />
        </Link>
        <NavigationRail />
        <form action={logout} className="mt-auto">
          <button
            type="submit"
            className="flex w-20 flex-col items-center gap-1 rounded-lg py-1 text-on-surface-variant hover:text-on-surface"
            title={`Signed in as ${operator.username}`}
          >
            <span className="grid h-8 w-14 place-items-center rounded-full hover:bg-surface-highest">
              <LogOut aria-hidden className="size-5" />
            </span>
            <span className="type-label text-xs">Sign out</span>
          </button>
        </form>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-outline-variant bg-surface/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
          <Link href="/projects" className="flex h-14 items-center gap-2" aria-label="Faultline home">
            <LogoMark className="size-7" />
            <span className="type-display text-lg">Faultline</span>
          </Link>
          <form action={logout}>
            <button type="submit" className="grid size-11 place-items-center rounded-full text-on-surface-variant hover:bg-surface-high" aria-label={`Sign out ${operator.username}`}>
              <LogOut aria-hidden className="size-5" />
            </button>
          </form>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1320px] flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-8 md:pt-10 md:pb-16">
          {children}
        </main>
      </div>
      <BottomNavigation />
    </div>
  );
}
