"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
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
      {tags.length > 0 && (
        <select
          defaultValue={searchParams.get("tag") ?? ""}
          onChange={(e) => updateParam("tag", e.target.value)}
          className="rounded-lg border border-border-medium bg-white px-2 py-2 text-sm text-ink-secondary"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
