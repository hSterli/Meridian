"use client";

import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Layers } from "lucide-react";

export function TestCaseSuiteSidebar({
  suites,
}: {
  suites: { id: string; name: string }[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSuite = searchParams.get("suite");

  function hrefFor(suiteId?: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (suiteId) params.set("suite", suiteId);
    else params.delete("suite");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  if (suites.length === 0) return null;

  return (
    <div>
      <p className="mb-2 px-2 text-[11px] font-ui-label font-bold uppercase tracking-widest text-ink-tertiary">
        Suites
      </p>
      <nav className="space-y-1">
        <Link
          href={hrefFor()}
          className={clsx(
            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-ui-label font-semibold transition-colors",
            !activeSuite ? "bg-meridian-soft text-meridian-dark" : "text-ink-secondary hover:bg-paper-muted"
          )}
        >
          All test cases
        </Link>
        {suites.map((s) => (
          <Link
            key={s.id}
            href={hrefFor(s.id)}
            className={clsx(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
              activeSuite === s.id
                ? "bg-meridian-soft font-semibold text-meridian-dark"
                : "text-ink-secondary hover:bg-paper-muted"
            )}
          >
            <Layers size={14} className="shrink-0" />
            <span className="truncate">{s.name}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
