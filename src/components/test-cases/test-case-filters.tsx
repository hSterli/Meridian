"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { clsx } from "clsx";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export interface SelectCustomFieldFilter {
  id: string;
  name: string;
  options: string[];
}

const FILTER_PARAM_KEYS = ["feature", "priority", "status", "tag"];

function countActiveFilters(
  searchParams: { get(key: string): string | null },
  selectCustomFields: SelectCustomFieldFilter[]
): number {
  let count = 0;
  for (const key of FILTER_PARAM_KEYS) {
    if (searchParams.get(key)) count += 1;
  }
  for (const field of selectCustomFields) {
    if (searchParams.get(`cf_${field.id}`)) count += 1;
  }
  return count;
}

export function TestCaseFilters({
  tags,
  features,
  selectCustomFields = [],
}: {
  tags: string[];
  features: string[];
  selectCustomFields?: SelectCustomFieldFilter[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [, startTransition] = useTransition();
  const activeCount = countActiveFilters(searchParams, selectCustomFields);
  const [filtersOpen, setFiltersOpen] = useState(activeCount > 0);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
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
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-border-light px-3 py-1.5 text-sm text-ink-secondary hover:bg-paper-muted"
        >
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-meridian-soft px-1.5 py-0.5 text-[11px] font-ui-label font-bold text-meridian-dark">
              {activeCount}
            </span>
          )}
          {filtersOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-2">
          {features.length > 0 && (
            <Select
              defaultValue={searchParams.get("feature") ?? ""}
              onChange={(e) => updateParam("feature", e.target.value)}
              className="text-ink-secondary"
            >
              <option value="">All features</option>
              {features.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          )}
          <Select
            defaultValue={searchParams.get("priority") ?? ""}
            onChange={(e) => updateParam("priority", e.target.value)}
            className="text-ink-secondary"
          >
            <option value="">All priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
          <Select
            defaultValue={searchParams.get("status") ?? ""}
            onChange={(e) => updateParam("status", e.target.value)}
            className="text-ink-secondary"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="deprecated">Deprecated</option>
          </Select>
          {selectCustomFields.map((field) => (
            <Select
              key={field.id}
              defaultValue={searchParams.get(`cf_${field.id}`) ?? ""}
              onChange={(e) => updateParam(`cf_${field.id}`, e.target.value)}
              className="text-ink-secondary"
            >
              <option value="">All {field.name}</option>
              {field.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
          ))}
          <div className="h-6 w-px bg-border-light" />
          <Select
            defaultValue={searchParams.get("groupBy") ?? ""}
            onChange={(e) => updateParam("groupBy", e.target.value)}
            className="font-ui-label font-semibold text-ink-secondary"
          >
            <option value="">No grouping</option>
            <option value="feature">Group by feature</option>
            <option value="sprint">Group by sprint</option>
          </Select>

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
      )}
    </div>
  );
}
