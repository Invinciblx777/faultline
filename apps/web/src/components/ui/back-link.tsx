import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="type-label inline-flex w-fit items-center gap-1.5 rounded-full py-1 pr-3 text-on-surface-variant hover:text-on-surface">
      <ArrowLeft aria-hidden className="size-4" />
      {children}
    </Link>
  );
}
