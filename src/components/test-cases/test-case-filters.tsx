"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { clsx } from "clsx";
import { Input } from "@/components/ui/input";

export function TestCaseFilters({ tags, features }: { tags: string[]; features: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [, startTransition] = useTransition();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Search title…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          updateParam("q", e.target.value);
        }}
        className="max-w-xs"
      />
      {features.length > 0 && (
        <select
          defaultValue={searchParams.get("feature") ?? ""}
          onChange={(e) => updateParam("feature", e.target.value)}
          className="rounded-lg border border-border-medium bg-white px-2 py-2 text-sm text-ink-secondary"
        >
          <option value="">All features</option>
          {features.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}
      <select
        defaultValue={searchParams.get("priority") ?? ""}
        onChange={(e) => updateParam("priority", e.target.value)}
        className="rounded-lg border border-border-medium bg-white px-2 py-2 text-sm text-ink-secondary"
      >
        <option value="">All priorities</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>
      <select
        defaultValue={searchParams.get("status") ?? ""}
        onChange={(e) => updateParam("status", e.target.value)}
        className="rounded-lg border border-border-medium bg-white px-2 py-2 text-sm text-ink-secondary"
      >
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="draft">Draft</option>
        <option value="deprecated">Deprecated</option>
      </select>
      <div className="h-6 w-px bg-border-light" />
      <select
        defaultValue={searchParams.get("groupBy") ?? ""}
        onChange={(e) => updateParam("groupBy", e.target.value)}
        className="rounded-lg border border-border-medium bg-white px-2 py-2 text-sm font-ui-label font-semibold text-ink-secondary"
      >
        <option value="">No grouping</option>
        <option value="feature">Group by feature</option>
        <option value="sprint">Group by sprint</option>
      </select>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => {
            const active = searchParams.get("tag") === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => updateParam("tag", active ? "" : t)}
                className={clsx(
                  "rounded-full px-2.5 py-1 text-[11px] font-ui-label font-bold transition-colors",
                  active
                    ? "bg-meridian-soft text-meridian-dark"
                    : "bg-surface-container-highest text-ink-secondary hover:bg-paper-muted"
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
