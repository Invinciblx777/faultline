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
      <aside className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col items-center gap-8 bg-surface-container py-6 md:flex">
        <Link href="/projects" aria-label="Faultline home" className="grid size-14 place-items-center rounded-lg bg-primary-container">
          <LogoMark className="size-8" />
        </Link>
        <NavigationRail />
        <form action={logout} className="mt-auto">
          <button
            type="submit"
            className="flex min-h-12 w-20 flex-col items-center gap-1 rounded-lg py-1 text-on-surface-variant hover:text-on-surface"
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
        <header className="sticky top-0 z-30 flex items-center justify-between bg-surface-container px-4 pt-[env(safe-area-inset-top)] md:hidden">
          <Link href="/projects" className="flex h-14 items-center gap-2" aria-label="Faultline home">
            <LogoMark className="size-7" />
            <span className="md-title-large">Faultline</span>
          </Link>
          <form action={logout}>
            <button type="submit" className="grid size-12 place-items-center rounded-full text-on-surface-variant hover:bg-surface-high" aria-label={`Sign out ${operator.username}`}>
              <LogOut aria-hidden className="size-5" />
            </button>
          </form>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1248px] flex-1 px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6 md:pt-8 md:pb-16">
          {children}
        </main>
      </div>
      <BottomNavigation />
    </div>
  );
}
