# Collapsible Test Case Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Note for this repo**: neither named sub-skill is installed here. Given the size of this change (one client component, no schema/server changes), this plan is executed inline in the current session rather than via subagent dispatch.

**Goal:** Collapse the Test Case list's filter toolbar behind a "Filters" toggle button, keeping only Search always visible, so the toolbar is less crowded by default.

**Architecture:** Purely a client-side change to `TestCaseFilters` — add a `filtersOpen` boolean state (defaulting to whether any filter param is already active in the URL), a toggle button with an active-filter-count badge next to Search, and wrap the existing controls (features/priorities/statuses/custom fields/grouping/tags) in a conditional block. No new files, no URL-param behavior changes, no server-side changes.

**Tech Stack:** React client component, `next/navigation` (`useSearchParams`/`usePathname`/`useRouter`, already in use), `lucide-react` icons (`ChevronDown`/`ChevronUp`, already used elsewhere in this codebase).

---

### Task 1: Add the collapsible toggle to `TestCaseFilters`

**Files:**
- Modify: `src/components/test-cases/test-case-filters.tsx` (full file, 136 lines)

- [ ] **Step 1: Replace the file with the updated version**

The current file (read in full before writing this plan) renders every filter control in one always-visible `<div className="flex flex-wrap items-center gap-2">`. Replace the entire contents of `src/components/test-cases/test-case-filters.tsx` with:

```tsx
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
```

What changed versus the original: the `q` state, `updateParam`, and every individual filter control (`Select`s, tag pills) are byte-for-byte identical to the current file — only the wrapping structure changed (new `countActiveFilters` helper, new `filtersOpen` state, new toggle button, and the existing controls block wrapped in `{filtersOpen && (...)}`). `countActiveFilters` takes a minimal structural type (`{ get(key): string | null }`) rather than importing `ReadonlyURLSearchParams` from `next/navigation`, since the existing file never imports that type either — it just relies on the hook's inferred return type, and the structural type is sufficient for what the function needs.

Check for the stray `</content>` line per this repo's known Write-tool quirk: `tail -3 src/components/test-cases/test-case-filters.tsx`, strip with `sed -i '' -e '/^<\/content>$/d' src/components/test-cases/test-case-filters.tsx` if present.

- [ ] **Step 2: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/test-cases/test-case-filters.tsx`
Expected: no output.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/test-cases/test-case-filters.tsx
git commit -m "Collapse Test Case filters behind a toggle button"
```

---

**Note on testing:** no automated test is added, matching the design spec's own call — this is a pure client-side visibility toggle with no business logic, and the existing filter controls' behavior (URL param wiring) is completely unchanged, just relocated behind a conditional. Manual verification: load the Test Cases page with no filters active (toolbar should start collapsed, Search-only), apply a filter then reload the page via a fresh navigation with that filter still in the URL (toolbar should start expanded), and confirm the badge count matches the number of active filters.
