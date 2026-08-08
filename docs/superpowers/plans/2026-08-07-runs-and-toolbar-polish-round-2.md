# Runs & Toolbar Polish, Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Note for this repo**: neither named sub-skill is installed here. Executed inline in the current session rather than via subagent dispatch, matching the two prior small polish rounds this session.

**Goal:** Fix the unreadable ENTER badge on the run executor's Pass Case button, add a hover breakdown to the Runs list status bar, clean up the duplicated/scattered CSV import-export controls on the Test Cases page (behind this codebase's first modal component), hide the redundant "Filters" label once the panel is open, and turn tag filtering into a dropdown.

**Architecture:** Six small, mostly-independent edits across five existing files plus one new reusable component (`src/components/ui/modal.tsx`). No schema or server-action changes.

**Tech Stack:** React client components, `lucide-react` (`X` icon, already available), native browser `title` attributes for tooltips (no tooltip library exists in this codebase).

---

### Task 1: Fix the ENTER badge contrast on the Pass Case button

**Files:**
- Modify: `src/components/runs/run-executor.tsx:220`

- [ ] **Step 1: Add an explicit text color for the Pass Case badge**

The shared `.kbd` class (`src/app/globals.css:85-93`) sets no text color, so the badge inherits whatever its parent button sets. The Pass Case button sets `text-white` (its `className` includes `bg-meridian-dark text-white hover:shadow-lg`), which combined with `.kbd`'s light `paper-muted` background makes the "ENTER" text unreadable. The other three status buttons have light backgrounds with dark text, so they're unaffected.

Replace line 220:
```tsx
                <span className="kbd absolute right-2 top-1 opacity-60">{cfg.key}</span>
```
with:
```tsx
                <span
                  className={clsx(
                    "kbd absolute right-2 top-1 opacity-60",
                    status === "passed" && "text-ink-primary"
                  )}
                >
                  {cfg.key}
                </span>
```

`clsx` is already imported at the top of this file (`import { clsx } from "clsx";`) — no new import needed.

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/runs/run-executor.tsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/runs/run-executor.tsx
git commit -m "Fix unreadable ENTER badge on the Pass Case button"
```

---

### Task 2: Hover breakdown on the Runs list status bar

**Files:**
- Modify: `src/components/runs/runs-table.tsx:189`

- [ ] **Step 1: Add a `title` attribute to the segmented bar**

`row.segments` already carries all five counts (`passed`/`failed`/`blocked`/`skipped`/`pending`), already rendered as colored bar segments — just missing a hover summary. Replace line 189:
```tsx
                    <div className="flex h-2 w-40 overflow-hidden rounded-full bg-surface-container-highest">
```
with:
```tsx
                    <div
                      className="flex h-2 w-40 overflow-hidden rounded-full bg-surface-container-highest"
                      title={`Passed: ${row.segments.passed} · Failed: ${row.segments.failed} · Blocked: ${row.segments.blocked} · Skipped: ${row.segments.skipped} · Not run: ${row.segments.pending}`}
                    >
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/runs/runs-table.tsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/runs/runs-table.tsx
git commit -m "Add hover breakdown to the Runs list status bar"
```

---

### Task 3: New Modal component

**Files:**
- Create: `src/components/ui/modal.tsx`

- [ ] **Step 1: Write the component**

This codebase has no dialog/modal/popover primitive yet (confirmed by searching `src/components/ui/` and the rest of `src/`). Create `src/components/ui/modal.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-ui-label text-sm font-bold text-ink-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink-tertiary hover:bg-paper-muted hover:text-ink-primary"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

Scope deliberately minimal: no focus trap, no portal (a `fixed inset-0` overlay visually covers the page without one), no animation — click-outside-to-close (the overlay's `onClick`, stopped from propagating by the inner panel's own `onClick`) and Escape-to-close cover the essential UX.

Check for the stray `</content>` line per this repo's known Write-tool quirk: `tail -3 src/components/ui/modal.tsx`, strip with `sed -i '' -e '/^<\/content>$/d' src/components/ui/modal.tsx` if present.

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/ui/modal.tsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/modal.tsx
git commit -m "Add reusable Modal component"
```

---

### Task 4: Move CSV import behind the new modal

**Files:**
- Modify: `src/components/test-cases/import-csv-form.tsx` (full file, 36 lines)

- [ ] **Step 1: Replace the file**

The current file (read in full before writing this plan) always renders the file input inline. Replace the entire contents of `src/components/test-cases/import-csv-form.tsx` with:

```tsx
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { bulkImportTestCases } from "@/lib/actions/test-cases";
import type { ActionState } from "@/lib/actions/auth";

export function ImportCsvForm({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const action = bulkImportTestCases.bind(null, projectId);
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (submitted && !isPending && !state.error) {
      setOpen(false);
      setSubmitted(false);
      formRef.current?.reset();
    }
  }, [submitted, isPending, state.error]);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Import CSV
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Import test cases from CSV">
        <form
          ref={formRef}
          action={(formData) => {
            setSubmitted(true);
            formAction(formData);
          }}
          className="flex flex-col gap-3"
        >
          <input
            type="file"
            name="file"
            accept=".csv"
            required
            className="text-xs text-ink-secondary file:mr-2 file:rounded-md file:border-0 file:bg-paper-muted file:px-2 file:py-1.5 file:text-xs file:font-medium"
          />
          <Button type="submit" variant="secondary" disabled={isPending}>
            {isPending ? "Importing…" : "Import"}
          </Button>
          {state.error && <span className="text-xs text-fail">{state.error}</span>}
        </form>
      </Modal>
    </>
  );
}
```

This is deliberately **not** the "await formAction, then always reset+close" shape you might reach for first — that would close the modal (and hide any error message) on every submission, success or failure. Instead, `submitted` tracks that a submit was attempted, and the `useEffect` only closes/resets once the action has finished (`!isPending`) with no error — a failed import leaves the modal open with the error message visible, so the user can see what went wrong and retry.

Check for the stray `</content>` line: `tail -3 src/components/test-cases/import-csv-form.tsx`.

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/test-cases/import-csv-form.tsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/test-cases/import-csv-form.tsx
git commit -m "Move CSV import behind a modal instead of an always-visible file input"
```

---

### Task 5: Reposition Import CSV, remove the duplicate Export CSV link

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/test-cases/page.tsx:2`, `:261-270`, `:292-310`, `:331-341`

- [ ] **Step 1: Drop the now-unused `Download` icon import**

Line 2 currently reads:
```tsx
import { Sparkles, PieChart, Download, SlidersHorizontal } from "lucide-react";
```
`Download` is only used by the Quick Actions "Export as CSV" link being removed in Step 3 below — after that removal it would be an unused import. Change line 2 to:
```tsx
import { Sparkles, PieChart, SlidersHorizontal } from "lucide-react";
```

- [ ] **Step 2: Move `ImportCsvForm` into the header action row**

Replace the `PageHeader`'s `action` prop (currently lines 261-270):
```tsx
        action={
          <div className="flex gap-2">
            <a href={`/projects/${projectId}/test-cases/export`}>
              <Button variant="secondary">Export CSV</Button>
            </a>
            <Link href={`/projects/${projectId}/test-cases/new`}>
              <Button>New test case</Button>
            </Link>
          </div>
        }
```
with:
```tsx
        action={
          <div className="flex items-center gap-2">
            <a href={`/projects/${projectId}/test-cases/export`}>
              <Button variant="secondary">Export CSV</Button>
            </a>
            <ImportCsvForm projectId={projectId} />
            <Link href={`/projects/${projectId}/test-cases/new`}>
              <Button>New test case</Button>
            </Link>
          </div>
        }
```

- [ ] **Step 3: Remove the duplicate "Export as CSV" link from Quick Actions**

Replace the Quick Actions `Card` (currently lines 292-310):
```tsx
          <Card className="p-3">
            <p className="font-ui-label text-xs font-bold uppercase tracking-wide text-ink-tertiary">
              Quick actions
            </p>
            <a
              href={`/projects/${projectId}/test-cases/export`}
              className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-paper-muted hover:text-ink-primary"
            >
              <Download size={14} />
              Export as CSV
            </a>
            <Link
              href={`/projects/${projectId}/test-cases/custom-fields`}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-paper-muted hover:text-ink-primary"
            >
              <SlidersHorizontal size={14} />
              Manage custom fields
            </Link>
          </Card>
```
with:
```tsx
          <Card className="p-3">
            <p className="font-ui-label text-xs font-bold uppercase tracking-wide text-ink-tertiary">
              Quick actions
            </p>
            <Link
              href={`/projects/${projectId}/test-cases/custom-fields`}
              className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-paper-muted hover:text-ink-primary"
            >
              <SlidersHorizontal size={14} />
              Manage custom fields
            </Link>
          </Card>
```
(the remaining `Link` picks up the `mt-2` the removed `<a>` used to provide, for spacing below the "Quick actions" label)

- [ ] **Step 4: Remove `ImportCsvForm` from its old position**

Replace (currently lines 331-341):
```tsx
          <div className="mb-4 flex items-center justify-between">
            <TestCaseFilters
              tags={(tags ?? []).map((t) => t.name)}
              features={(features ?? []).map((f) => f.name)}
              selectCustomFields={(customFieldDefs ?? [])
                .filter((f) => f.field_type === "select")
                .map((f) => ({ id: f.id, name: f.name, options: (f.options as string[]) ?? [] }))}
            />
            <ImportCsvForm projectId={projectId} />
          </div>
```
with:
```tsx
          <div className="mb-4">
            <TestCaseFilters
              tags={(tags ?? []).map((t) => t.name)}
              features={(features ?? []).map((f) => f.name)}
              selectCustomFields={(customFieldDefs ?? [])
                .filter((f) => f.field_type === "select")
                .map((f) => ({ id: f.id, name: f.name, options: (f.options as string[]) ?? [] }))}
            />
          </div>
```
(dropped `flex items-center justify-between` — with only `TestCaseFilters` left as a child, that layout no longer does anything)

`ImportCsvForm`'s import statement (`import { ImportCsvForm } from "@/components/test-cases/import-csv-form";`) stays unchanged — it's still used, just rendered from the header now instead of here.

- [ ] **Step 5: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/(app)/projects/[projectId]/test-cases/page.tsx"`
Expected: no output.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/test-cases/page.tsx"
git commit -m "Move Import CSV to the header, remove duplicate Export CSV link"
```

---

### Task 6: Hide "Filters" label when open, tags as a dropdown

**Files:**
- Modify: `src/components/test-cases/test-case-filters.tsx` (full file, 175 lines)

- [ ] **Step 1: Replace the file**

The current file (read in full before writing this plan) always shows the "Filters" text label and renders tags as individual pill buttons. Replace the entire contents of `src/components/test-cases/test-case-filters.tsx` with:

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
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
          {!filtersOpen && "Filters"}
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
            <Select
              defaultValue={searchParams.get("tag") ?? ""}
              onChange={(e) => updateParam("tag", e.target.value)}
              className="shrink-0 text-ink-secondary"
            >
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
```

Two things worth noting versus the previous version: (1) the `Filters` label is now `{!filtersOpen && "Filters"}` — hidden once the panel is open, icon (and count badge, if active) remain; (2) `clsx` is no longer imported — it was only used by the removed tag-pills block's conditional active/inactive styling, and the replacement `<Select>` needs no conditional className. Tag filtering itself is unchanged in capability (still single-value, `tag` param), just re-skinned from pill buttons to a dropdown matching the other filter controls' exact pattern.

Check for the stray `</content>` line: `tail -3 src/components/test-cases/test-case-filters.tsx`.

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
git commit -m "Hide Filters label when open, convert tag filter to a dropdown"
```

---

**Note on testing:** no automated tests are added — every change in this plan is presentational (a CSS fix, a native tooltip, a new but minimal modal component, layout rearrangement, and a dropdown swap with no underlying logic change). Manual verification: confirm the ENTER text is legible on the Pass Case button; hover a run's status bar on the Runs list and confirm all five counts show; click "Import CSV" in the Test Cases header and confirm a modal opens (Escape and click-outside both close it); submit an invalid file and confirm the modal stays open with the error visible, then a valid file and confirm it closes and the list refreshes; confirm only one "Export CSV" control remains on the page; open Filters and confirm the button's text disappears while open, reappears when closed; confirm the tag filter is now a single dropdown instead of pill buttons.
