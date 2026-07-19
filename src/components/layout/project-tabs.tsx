"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

const TABS = [
  { segment: "test-cases", label: "Test Cases" },
  { segment: "runs", label: "Runs" },
  { segment: "issues", label: "Issues" },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();

  return (
    <nav className="mt-4 flex gap-4">
      {TABS.map((tab) => {
        const href = `/projects/${projectId}/${tab.segment}`;
        const active = pathname?.startsWith(href);
        return (
          <Link
            key={tab.segment}
            href={href}
            className={clsx(
              "border-b-2 pb-2 text-sm font-medium transition-colors",
              active
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
