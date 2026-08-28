"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

const TABS = [
  { segment: "test-cases", label: "Test Cases" },
  { segment: "suites", label: "Suites" },
  { segment: "runs", label: "Runs" },
  { segment: "issues", label: "Issues" },
  { segment: "reports", label: "Reports" },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-6 border-b border-border-light">
      {TABS.map((tab) => {
        const href = `/projects/${projectId}/${tab.segment}`;
        const active = pathname?.startsWith(href);
        return (
          <Link
            key={tab.segment}
            href={href}
            className={clsx(
              "-mb-px border-b-2 pb-2 text-sm font-ui-label font-semibold transition-colors",
              active
                ? "border-meridian-dark text-meridian-dark"
                : "border-transparent text-ink-tertiary hover:text-ink-primary"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
