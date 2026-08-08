# Test Cases Toolbar Polish + Collapsible Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Note for this repo**: neither named sub-skill is installed here. Given the size of this change (two small edits + one component addition, no schema/server changes), this plan is executed inline in the current session rather than via subagent dispatch.

**Goal:** Swap the filter toggle to a proper icon, keep the expanded filter row on one line with horizontal scroll instead of wrapping, default the Test Cases list to group-by-feature (without breaking an explicit "No grouping" choice), and add a collapsible icon-only sidebar.

**Architecture:** Three small, independent edits: `TestCaseFilters` (icon + layout + groupBy option fix), the Test Cases page (a single computed `effectiveGroupBy` replacing raw `groupBy` reads), and `Sidebar` (new local collapsed state persisted to `localStorage`). No new files, no server/schema changes.

**Tech Stack:** React client components, `lucide-react` icons (`SlidersHorizontal`, `PanelLeftClose`, `PanelLeftOpen`, already available in this codebase's installed version), `localStorage`.

---

### Task 1: Filter icon, one-line layout, and groupBy default fix

**Files:**
- Modify: `src/components/test-cases/test-case-filters.tsx` (full file, 175 lines)

- [ ] **Step 1: Replace the file**

The current file (read in full before writing this plan) has a plain "Filters" text button, a `flex-wrap` expanded row, and a groupBy `<Select>` whose "No grouping" option uses `value=""` — which the shared `updateParam` helper treats identically to "never touched this control" (both delete the URL param), so a default-to-feature change would silently override an explicit "No grouping" choice. Fixing that needs "No grouping" to have its own truthy value (`"none"`) instead.

Replace the entire contents of `src/components/test-cases/test-case-filters.tsx` with:

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { clsx } from "clsx";
import { SlidersHorizontal } from "lucide-react";
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
          <SlidersHorizontal size={14} />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-meridian-soft px-1.5 py-0.5 text-[11px] font-ui-label font-bold text-meridian-dark">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {filtersOpen && (
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
          {features.length > 0 && (
            <Select
              defaultValue={searchParams.get("feature") ?? ""}
              onChange={(e) => updateParam("feature", e.target.value)}
              className="shrink-0 text-ink-secondary"
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
            className="shrink-0 text-ink-secondary"
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
            className="shrink-0 text-ink-secondary"
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
              className="shrink-0 text-ink-secondary"
            >
              <option value="">All {field.name}</option>
              {field.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
          ))}
          <div className="h-6 w-px shrink-0 bg-border-light" />
          <Select
            defaultValue={searchParams.get("groupBy") ?? "feature"}
            onChange={(e) => updateParam("groupBy", e.target.value)}
            className="shrink-0 font-ui-label font-semibold text-ink-secondary"
          >
            <option value="none">No grouping</option>
            <option value="feature">Group by feature</option>
            <option value="sprint">Group by sprint</option>
          </Select>

          {tags.length > 0 && (
            <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
              {tags.map((t) => {
                const active = searchParams.get("tag") === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => updateParam("tag", active ? "" : t)}
                    className={clsx(
                      "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-ui-label font-bold transition-colors",
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

What changed versus the previous version: (1) `ChevronDown`/`ChevronUp` import and the trailing chevron in the toggle button are removed, `SlidersHorizontal` is added and rendered before the "Filters" label; (2) the expanded row's class changed from `flex flex-wrap items-center gap-2` to `flex flex-nowrap items-center gap-2 overflow-x-auto pb-1` (the `pb-1` gives the horizontal scrollbar a little breathing room so it doesn't sit flush against the controls), and every direct child of that row gets `shrink-0` so flexbox doesn't squeeze individual controls instead of scrolling the row as a whole; (3) the groupBy `<Select>`'s "No grouping" option changed from `value=""` to `value="none"`, and its `defaultValue` changed from `searchParams.get("groupBy") ?? ""` to `searchParams.get("groupBy") ?? "feature"`.

Check for the stray `</content>` line per this repo's known Write-tool quirk: `tail -3 src/components/test-cases/test-case-filters.tsx`, strip with `sed -i '' -e '/^<\/content>$/d' src/components/test-cases/test-case-filters.tsx` if present.

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/test-cases/test-case-filters.tsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/test-cases/test-case-filters.tsx
git commit -m "Use SlidersHorizontal icon, keep filters on one line, fix groupBy default"
```

---

### Task 2: Wire the new groupBy default into the Test Cases page

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/test-cases/page.tsx:48`, `:165`, `:168`, `:175`, `:184`, `:214`, `:217`

- [ ] **Step 1: Add the computed `effectiveGroupBy`**

Immediately after line 48 (`const { q, priority, status, tag, feature, groupBy, suite } = resolvedSearchParams;`), add:

```ts
  const effectiveGroupBy = groupBy === "none" ? undefined : (groupBy ?? "feature");
```

- [ ] **Step 2: Replace every raw `groupBy` read below that line with `effectiveGroupBy`**

There are six call sites, all reading the raw `groupBy` destructured value. Replace each:

In `groupKeyFor` (currently around line 165):
```ts
  function groupKeyFor(tc: TestCaseRow): string {
    if (effectiveGroupBy === "sprint") {
      return tc.sprint_number != null ? `Sprint ${tc.sprint_number}` : "No sprint";
    }
    if (effectiveGroupBy === "feature") {
      return featureName(tc) ?? "No feature";
    }
    return "";
  }
```

In the groups-building block (currently around lines 174-196):
```ts
  const groups: { label: string; items: TestCaseRow[] }[] = [];
  if (effectiveGroupBy === "feature" || effectiveGroupBy === "sprint") {
    const byLabel = new Map<string, TestCaseRow[]>();
    for (const tc of filtered) {
      const label = groupKeyFor(tc);
      const bucket = byLabel.get(label) ?? [];
      bucket.push(tc);
      byLabel.set(label, bucket);
    }
    const labels = Array.from(byLabel.keys()).sort((a, b) => {
      if (effectiveGroupBy === "sprint") {
        if (a === "No sprint") return 1;
        if (b === "No sprint") return -1;
        return Number(a.replace("Sprint ", "")) - Number(b.replace("Sprint ", ""));
      }
      if (a === "No feature") return 1;
      if (b === "No feature") return -1;
      return a.localeCompare(b);
    });
    for (const label of labels) {
      groups.push({ label, items: byLabel.get(label)! });
    }
  }
```

In `TestCaseRowItem` (currently around lines 213-219, the two badge-suppression checks):
```tsx
            {effectiveGroupBy !== "feature" && featureName(tc) && (
              <Badge tone="indigo">{featureName(tc)}</Badge>
            )}
            {effectiveGroupBy !== "sprint" && tc.sprint_number != null && (
              <Badge tone="blue">Sprint {tc.sprint_number}</Badge>
            )}
```

Search the file for any other bare `groupBy` reference below line 48 you may have missed (the destructured `groupBy` itself should no longer be read directly anywhere past this point — only `effectiveGroupBy`) and update it the same way.

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/(app)/projects/[projectId]/test-cases/page.tsx"`
Expected: no output.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/test-cases/page.tsx"
git commit -m "Default Test Cases list to group-by-feature via effectiveGroupBy"
```

---

### Task 3: Collapsible sidebar

**Files:**
- Modify: `src/components/layout/sidebar.tsx` (full file, 139 lines)

- [ ] **Step 1: Replace the file**

The current file (read in full before writing this plan) renders a fixed `w-60` sidebar with no collapse capability. Replace the entire contents of `src/components/layout/sidebar.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  LogOut,
  ChevronDown,
  Plus,
  HelpCircle,
  BarChart3,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useEffect, useState } from "react";
import { signOut } from "@/lib/actions/auth";
import { switchActiveOrg } from "@/lib/actions/orgs";
import type { OrgRole } from "@/lib/types/database";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/settings/members", label: "Team", icon: Users },
];

const COLLAPSED_STORAGE_KEY = "meridian-sidebar-collapsed";

export function Sidebar({
  orgs,
  activeOrgId,
  activeOrgName,
  activeRole,
  userEmail,
}: {
  orgs: { id: string; name: string }[];
  activeOrgId: string | null;
  activeOrgName: string;
  activeRole: OrgRole | null;
  userEmail: string | null;
}) {
  const pathname = usePathname();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <aside
      className={clsx(
        "flex shrink-0 flex-col bg-ink-primary py-6 shadow-sm transition-all",
        collapsed ? "w-16 px-2" : "w-60 px-4"
      )}
    >
      <div className="mb-8 px-2">
        <div className={clsx("flex items-center", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <h1 className="font-headline-sm text-[21px] font-semibold text-primary-fixed-dim tracking-tight">
              Meridian QA
            </h1>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-lg p-1.5 text-ink-tertiary hover:bg-white/5 hover:text-white"
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        {!collapsed && (
          <div className="relative mt-3">
            <button
              type="button"
              onClick={() => setSwitcherOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-white/10 px-2 py-1.5 text-sm text-ink-tertiary hover:bg-white/5"
            >
              <span className="truncate">{activeOrgName || "Select team"}</span>
              <ChevronDown size={14} />
            </button>
            {switcherOpen && orgs.length > 1 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-border-light bg-white py-1 shadow-lg">
                {orgs.map((org) => (
                  <form key={org.id} action={switchActiveOrg.bind(null, org.id)}>
                    <button
                      type="submit"
                      className={clsx(
                        "block w-full truncate px-3 py-1.5 text-left text-sm text-ink-primary hover:bg-paper-muted",
                        org.id === activeOrgId && "font-bold text-primary"
                      )}
                    >
                      {org.name}
                    </button>
                  </form>
                ))}
              </div>
            )}
          </div>
        )}
        {!collapsed && activeRole && (
          <span className="mt-2 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-ui-label font-bold capitalize text-primary-fixed-dim">
            {activeRole}
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-2">
        {NAV.map((item) => {
          const active =
            item.href === "/settings"
              ? pathname === "/settings"
              : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={clsx(
                "flex items-center gap-3 rounded-r-lg p-2 text-sm font-ui-label font-semibold transition-all",
                collapsed && "justify-center",
                active
                  ? "translate-x-1 border-l-4 border-primary-fixed-dim bg-meridian-dark text-primary-fixed"
                  : "text-ink-tertiary hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon size={16} />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2 border-t border-white/10 pt-6">
        <Link
          href="/projects/new"
          title={collapsed ? "New Project" : undefined}
          className={clsx(
            "mb-2 flex w-full items-center gap-2 rounded-lg bg-primary-container py-2.5 text-sm font-ui-label font-bold text-on-primary-container transition-opacity hover:opacity-90",
            collapsed ? "justify-center" : "justify-center"
          )}
        >
          <Plus size={16} />
          {!collapsed && "New Project"}
        </Link>
        {!collapsed && <div className="truncate px-2 text-xs text-ink-tertiary">{userEmail}</div>}
        <Link
          href="/onboarding"
          title={collapsed ? "Help Center" : undefined}
          className={clsx(
            "flex w-full items-center gap-3 rounded-lg p-2 text-sm text-ink-tertiary hover:bg-white/5 hover:text-white",
            collapsed && "justify-center"
          )}
        >
          <HelpCircle size={16} />
          {!collapsed && "Help Center"}
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            title={collapsed ? "Log Out" : undefined}
            className={clsx(
              "flex w-full items-center gap-3 rounded-lg p-2 text-sm text-ink-tertiary hover:bg-white/5 hover:text-white",
              collapsed && "justify-center"
            )}
          >
            <LogOut size={16} />
            {!collapsed && "Log Out"}
          </button>
        </form>
      </div>
    </aside>
  );
}
```

What changed versus the previous version: added `PanelLeftClose`/`PanelLeftOpen` imports and `useEffect`; added `collapsed` state (defaults to `false` for the server-rendered/first-paint markup, then synced from `localStorage` in a post-mount `useEffect` — this avoids an SSR hydration mismatch, since `localStorage` isn't available during server rendering); added `toggleCollapsed()` which flips the state and writes it back to `localStorage` immediately; the `<aside>`'s width/padding classes are now conditional (`w-16 px-2` vs `w-60 px-4`); every text label (title, org switcher, role badge, nav labels, "New Project"/"Help Center"/"Log Out" text, user email) is conditionally rendered on `!collapsed`; nav items and the three bottom links/buttons get a `title` attribute (native tooltip) and `justify-center` when collapsed, so a collapsed icon is still identifiable on hover and stays centered in the narrow rail.

Check for the stray `</content>` line: `tail -3 src/components/layout/sidebar.tsx`, strip if present.

- [ ] **Step 2: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/layout/sidebar.tsx`
Expected: no output.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "Add collapsible icon-only sidebar, persisted via localStorage"
```

---

**Note on testing:** no automated tests are added, matching the design spec's own call — every change in this plan is presentational (an icon swap, a CSS layout change, a grouping default, and a client-side collapse toggle with no server round-trip). Manual verification: load the Test Cases page and confirm it defaults to grouped-by-feature with the filter row collapsed; open Filters and confirm the row scrolls horizontally rather than wrapping at a narrow window width; select "No grouping," reload the page, and confirm it stays ungrouped; click the sidebar's collapse toggle and confirm it shrinks to an icon rail, then reload the page and confirm the collapsed state persisted.
