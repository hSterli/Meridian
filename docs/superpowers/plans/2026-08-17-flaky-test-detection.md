# Flaky Test Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crude "any pass + any fail ever" flaky-test signal with a real, windowed score, and give it a full cross-project view instead of a top-5-only dashboard widget.

**Architecture:** One new pure function, `computeFlakyTests` in `src/lib/flaky-tests.ts`, in the same no-I/O/unit-tested style as `aggregateWeeklyMetrics` (`src/lib/weekly-report-metrics.ts`). Two existing pages become its consumers: the dashboard's existing widget (capped at 5) and the `/reports` page's "Flaky-test deep dive" stub, which becomes a real, unlimited list. No migration, no new table — everything is derived from `test_run_cases` rows already reachable via existing RLS-scoped queries.

**Tech Stack:** Next.js 16 App Router (Server Components), Supabase (Postgres/RLS, no schema change), TypeScript, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-17-flaky-test-detection-design.md` — read it first for the full rationale behind every scope decision below.

---

## Known repo quirk

Check `tail -3 <file>` after every file write for a stray literal `</content>` line; strip with `sed -i '' -e '/^<\/content>$/d' <file>` if present.

## Environment notes (confirm before Task 1)

- **git**: broken as of this plan's authoring session (`git --version` itself fails with an Xcode CLT license-agreement error — `sudo xcodebuild -license` needed, which only the user can run interactively). Confirm `git status` works before starting Task 1; if it's still broken, do the file edits anyway and hold the commits until it's fixed rather than skipping them.
- **Node/npm/npx**: unavailable in the authoring session (not in `PATH`, not found in any common install location). Every `Verify` step below needs an environment with Node available — run them there, don't assume they were already run.

---

### Task 1: `computeFlakyTests` — the scoring function

**Files:**
- Create: `src/lib/flaky-tests.ts`
- Test: `src/lib/flaky-tests.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/flaky-tests.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeFlakyTests, type RawFlakyRunCaseRow } from "./flaky-tests";

function row(
  testCaseId: string,
  status: RawFlakyRunCaseRow["status"],
  executedAt: string | null,
  title = "Test"
): RawFlakyRunCaseRow {
  return { testCaseId, title, status, executedAt };
}

describe("computeFlakyTests", () => {
  it("excludes a test case below the minimum-executions threshold", () => {
    const rows = [
      row("tc-1", "passed", "2026-08-10T00:00:00Z"),
      row("tc-1", "failed", "2026-08-11T00:00:00Z"),
    ];
    expect(computeFlakyTests(rows)).toEqual([]);
  });

  it("scores a test with 10 consecutive clean passes as exactly 0", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row("tc-1", "passed", `2026-08-${String(11 + i).padStart(2, "0")}T00:00:00Z`)
    );
    const result = computeFlakyTests(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      testCaseId: "tc-1",
      passed: 10,
      failed: 0,
      total: 10,
      score: 0,
    });
  });

  it("ignores an older 11th execution once it falls outside the window", () => {
    const rows = [
      // Oldest — an 11th execution, and a failure. Should be pushed out of the
      // window entirely once the 10 more recent passes are counted.
      row("tc-1", "failed", "2026-08-01T00:00:00Z"),
      ...Array.from({ length: 10 }, (_, i) =>
        row("tc-1", "passed", `2026-08-${String(11 + i).padStart(2, "0")}T00:00:00Z`)
      ),
    ];
    const result = computeFlakyTests(rows);
    expect(result[0]).toMatchObject({ passed: 10, failed: 0, total: 10, score: 0 });
  });

  it("excludes blocked, skipped, and pending results from both the window and the total", () => {
    const rows = [
      row("tc-1", "passed", "2026-08-10T00:00:00Z"),
      row("tc-1", "failed", "2026-08-11T00:00:00Z"),
      row("tc-1", "blocked", "2026-08-12T00:00:00Z"),
      row("tc-1", "skipped", "2026-08-13T00:00:00Z"),
      row("tc-1", "pending", null),
      row("tc-1", "passed", "2026-08-14T00:00:00Z"),
    ];
    const result = computeFlakyTests(rows, { minExecutions: 3 });
    expect(result[0]).toMatchObject({ total: 3, passed: 2, failed: 1 });
  });

  it("tie-breaks equal scores by total execution count, descending", () => {
    const rows = [
      // tc-1: 1 pass, 1 fail -> total 2, score 0.5
      row("tc-1", "passed", "2026-08-10T00:00:00Z"),
      row("tc-1", "failed", "2026-08-11T00:00:00Z"),
      // tc-2: 2 pass, 2 fail -> total 4, score 0.5 (same score, more runs)
      row("tc-2", "passed", "2026-08-10T00:00:00Z"),
      row("tc-2", "failed", "2026-08-11T00:00:00Z"),
      row("tc-2", "passed", "2026-08-12T00:00:00Z"),
      row("tc-2", "failed", "2026-08-13T00:00:00Z"),
    ];
    const result = computeFlakyTests(rows, { minExecutions: 2 });
    expect(result.map((r) => r.testCaseId)).toEqual(["tc-2", "tc-1"]);
  });

  it("applies limit after sorting, not before", () => {
    const rows = [
      // tc-1: 4 pass, 1 fail -> score 0.2 (low)
      row("tc-1", "passed", "2026-08-10T00:00:00Z"),
      row("tc-1", "passed", "2026-08-11T00:00:00Z"),
      row("tc-1", "passed", "2026-08-12T00:00:00Z"),
      row("tc-1", "passed", "2026-08-13T00:00:00Z"),
      row("tc-1", "failed", "2026-08-14T00:00:00Z"),
      // tc-2: 1 pass, 1 fail -> score 0.5 (higher — must win with limit: 1
      // even though it's inserted second and a Map would otherwise preserve
      // tc-1's insertion order)
      row("tc-2", "passed", "2026-08-10T00:00:00Z"),
      row("tc-2", "failed", "2026-08-11T00:00:00Z"),
    ];
    const result = computeFlakyTests(rows, { limit: 1, minExecutions: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].testCaseId).toBe("tc-2");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project unit src/lib/flaky-tests.test.ts`
Expected: FAIL — `src/lib/flaky-tests.ts` doesn't exist yet.

- [ ] **Step 3: Write `src/lib/flaky-tests.ts`**

```ts
export type FlakyRunCaseStatus = "pending" | "passed" | "failed" | "blocked" | "skipped";

export interface RawFlakyRunCaseRow {
  testCaseId: string;
  title: string;
  status: FlakyRunCaseStatus;
  executedAt: string | null;
}

export interface FlakyTestEntry {
  testCaseId: string;
  title: string;
  passed: number;
  failed: number;
  total: number;
  score: number; // min(passed, failed) / total, 0..0.5
}

export interface ComputeFlakyTestsOptions {
  windowSize?: number;
  minExecutions?: number;
  limit?: number;
}

const DEFAULT_WINDOW_SIZE = 10;
const DEFAULT_MIN_EXECUTIONS = 3;

// Pure — no I/O. Takes the same shape of joined test_run_cases/test_cases.title
// rows every caller already fetches, returns a scored, sorted, optionally
// capped list. See docs/superpowers/specs/2026-08-17-flaky-test-detection-design.md
// for the full rationale (bounded window instead of all-history or
// time-decay scoring).
export function computeFlakyTests(
  rows: RawFlakyRunCaseRow[],
  options?: ComputeFlakyTestsOptions
): FlakyTestEntry[] {
  const windowSize = options?.windowSize ?? DEFAULT_WINDOW_SIZE;
  const minExecutions = options?.minExecutions ?? DEFAULT_MIN_EXECUTIONS;

  // blocked/skipped/pending say nothing about pass/fail flakiness and must
  // never occupy a window slot — discard them before windowing, not after.
  const byTestCase = new Map<string, { title: string; rows: RawFlakyRunCaseRow[] }>();
  for (const row of rows) {
    if (row.status !== "passed" && row.status !== "failed") continue;
    const entry = byTestCase.get(row.testCaseId) ?? { title: row.title, rows: [] };
    entry.rows.push(row);
    byTestCase.set(row.testCaseId, entry);
  }

  const entries: FlakyTestEntry[] = [];
  for (const [testCaseId, { title, rows: caseRows }] of byTestCase) {
    const windowed = [...caseRows]
      .sort((a, b) => {
        const aTime = a.executedAt ? new Date(a.executedAt).getTime() : -Infinity;
        const bTime = b.executedAt ? new Date(b.executedAt).getTime() : -Infinity;
        return bTime - aTime;
      })
      .slice(0, windowSize);

    const total = windowed.length;
    if (total < minExecutions) continue;

    const passed = windowed.filter((r) => r.status === "passed").length;
    const failed = windowed.filter((r) => r.status === "failed").length;

    entries.push({ testCaseId, title, passed, failed, total, score: Math.min(passed, failed) / total });
  }

  entries.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.total - a.total));

  return options?.limit ? entries.slice(0, options.limit) : entries;
}
```

- [ ] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 src/lib/flaky-tests.ts`
Strip with `sed -i '' -e '/^<\/content>$/d' src/lib/flaky-tests.ts` if present. Repeat for `src/lib/flaky-tests.test.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/lib/flaky-tests.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/flaky-tests.ts src/lib/flaky-tests.test.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/flaky-tests.ts src/lib/flaky-tests.test.ts
git commit -m "Add computeFlakyTests: windowed pass/fail balance score, replacing has-any-pass-and-fail"
```

---

### Task 2: Wire the real score into the dashboard widget

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add `executed_at` to the `test_run_cases` query**

In `src/app/(app)/dashboard/page.tsx`, the query at (currently) line 71 is missing `executed_at`, which the new windowed score needs. Change:

```ts
      supabase
        .from("test_run_cases")
        .select("status, test_case_id, test_cases(title), test_runs!inner(project_id)")
        .in("test_runs.project_id", projectIds)
        .neq("status", "pending"),
```

to:

```ts
      supabase
        .from("test_run_cases")
        .select("status, test_case_id, executed_at, test_cases(title), test_runs!inner(project_id)")
        .in("test_runs.project_id", projectIds)
        .neq("status", "pending"),
```

- [ ] **Step 2: Replace the inline flaky computation with `computeFlakyTests`**

Add the import near the top of the file, alongside the other `@/lib/*` imports:

```ts
import { computeFlakyTests, type RawFlakyRunCaseRow } from "@/lib/flaky-tests";
```

Replace this block (currently lines 93–106):

```ts
  // Flaky-test tracker: test cases with both a pass and a fail somewhere in history.
  const byTestCase = new Map<string, { title: string; passed: number; failed: number }>();
  for (const rc of runCases ?? []) {
    const title = (rc as unknown as { test_cases: { title: string } | null }).test_cases?.title;
    if (!title) continue;
    const entry = byTestCase.get(rc.test_case_id) ?? { title, passed: 0, failed: 0 };
    if (rc.status === "passed") entry.passed += 1;
    if (rc.status === "failed") entry.failed += 1;
    byTestCase.set(rc.test_case_id, entry);
  }
  const flaky = Array.from(byTestCase.values())
    .filter((e) => e.passed > 0 && e.failed > 0)
    .sort((a, b) => b.failed - a.failed)
    .slice(0, 5);
```

with:

```ts
  const flakyRows: RawFlakyRunCaseRow[] = [];
  for (const rc of runCases ?? []) {
    const title = (rc as unknown as { test_cases: { title: string } | null }).test_cases?.title;
    if (!title) continue;
    flakyRows.push({
      testCaseId: rc.test_case_id,
      title,
      status: rc.status as RawFlakyRunCaseRow["status"],
      executedAt: (rc as unknown as { executed_at: string | null }).executed_at,
    });
  }
  const flaky = computeFlakyTests(flakyRows, { limit: 5 });
```

- [ ] **Step 3: Add a "See all" link to the widget heading**

Replace this (currently lines 173–176):

```tsx
        <div>
          <h2 className="mb-3 font-headline-sm text-[17px] font-semibold text-ink-primary">
            Flaky-test tracker
          </h2>
```

with:

```tsx
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-headline-sm text-[17px] font-semibold text-ink-primary">
              Flaky-test tracker
            </h2>
            <Link href="/reports" className="text-xs font-semibold text-primary">
              See all →
            </Link>
          </div>
```

(`Link` is already imported at the top of this file — no new import needed.)

- [ ] **Step 4: Update the empty-state copy to reflect the new threshold**

Replace:

```tsx
            {flaky.length === 0 && (
              <p className="p-4 text-sm text-ink-tertiary">
                No flaky tests detected yet — a test needs both a pass and a fail in history to
                show here.
              </p>
            )}
```

with:

```tsx
            {flaky.length === 0 && (
              <p className="p-4 text-sm text-ink-tertiary">
                No flaky tests detected yet — a test needs at least 3 recent executions with a
                mix of pass and fail to show here.
              </p>
            )}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/(app)/dashboard/page.tsx"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "Use computeFlakyTests for the dashboard widget; link to the full /reports view"
```

---

### Task 3: Build out the `/reports` "Flaky-test deep dive" stub

**Files:**
- Modify: `src/app/(app)/reports/page.tsx`

- [ ] **Step 1: Replace the full file contents**

The current file (55 lines) is a pure stub — `PLANNED_REPORTS` has 4 entries including "Flaky-test deep dive", no data fetching happens at all. Replace the entire file with:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, GitBranch, Gauge } from "lucide-react";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { computeFlakyTests, type RawFlakyRunCaseRow } from "@/lib/flaky-tests";

const PLANNED_REPORTS = [
  {
    icon: BarChart3,
    title: "Pass/fail trend",
    description: "Cross-project pass rate over time, drillable by project or date range.",
  },
  {
    icon: GitBranch,
    title: "Coverage by requirement",
    description: "Traceability from requirements through test cases to run results.",
  },
  {
    icon: Gauge,
    title: "Team velocity",
    description: "Test cases authored and runs executed per team member, per sprint.",
  },
];

// A test_runs!inner(...) or test_cases(...) join can come back as either a
// single object or a one-element array depending on how Supabase infers the
// relationship's cardinality — this codebase already handles that
// defensively elsewhere (see tagName/featureName in the Test Cases list
// page), so these two rows do the same rather than assuming one shape.
function joinedTitle(rc: { test_cases: { title: string } | { title: string }[] | null }) {
  return Array.isArray(rc.test_cases) ? rc.test_cases[0]?.title : rc.test_cases?.title;
}
function joinedProjectId(rc: { test_runs: { project_id: string } | { project_id: string }[] | null }) {
  return Array.isArray(rc.test_runs) ? rc.test_runs[0]?.project_id : rc.test_runs?.project_id;
}

export default async function ReportsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("org_id", ctx.activeOrgId);

  const projectIds = (projects ?? []).map((p) => p.id);
  const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.name]));

  const { data: runCases } = projectIds.length
    ? await supabase
        .from("test_run_cases")
        .select("status, test_case_id, executed_at, test_cases(title), test_runs!inner(project_id)")
        .in("test_runs.project_id", projectIds)
        .neq("status", "pending")
    : { data: [] as never[] };

  const testCaseProjectId = new Map<string, string>();
  const flakyRows: RawFlakyRunCaseRow[] = [];
  for (const rc of runCases ?? []) {
    const title = joinedTitle(rc);
    const projectId = joinedProjectId(rc);
    if (!title || !projectId) continue;
    testCaseProjectId.set(rc.test_case_id, projectId);
    flakyRows.push({
      testCaseId: rc.test_case_id,
      title,
      status: rc.status as RawFlakyRunCaseRow["status"],
      executedAt: (rc as unknown as { executed_at: string | null }).executed_at,
    });
  }

  const flaky = computeFlakyTests(flakyRows);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Reports"
        description="The dashboard already covers cross-project pass/fail trend and the flaky-test tracker. Deeper, exportable report templates are coming next."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PLANNED_REPORTS.map((r) => (
          <Card key={r.title} className="flex items-start gap-4 p-5 opacity-70">
            <div className="rounded-lg bg-meridian-soft p-2 text-primary">
              <r.icon size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-ui-label font-semibold text-ink-primary">{r.title}</p>
                <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[10px] font-ui-label font-bold uppercase tracking-wide text-ink-tertiary">
                  Coming soon
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-secondary">{r.description}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 font-headline-sm text-[17px] font-semibold text-ink-primary">
          Flaky tests
        </h2>
        <Card className="divide-y divide-border-light">
          {flaky.length === 0 && (
            <p className="p-4 text-sm text-ink-tertiary">
              No flaky tests detected yet — a test needs at least 3 recent executions with a mix
              of pass and fail to show here.
            </p>
          )}
          {flaky.map((f) => {
            const projectId = testCaseProjectId.get(f.testCaseId);
            return (
              <Link
                key={f.testCaseId}
                href={`/projects/${projectId}/test-cases/${f.testCaseId}`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-paper-surface"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-ui-label font-semibold text-ink-primary">
                    {f.title}
                  </div>
                  <div className="text-xs text-ink-tertiary">
                    {projectId ? (projectNameById.get(projectId) ?? "") : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="green">{f.passed} pass</Badge>
                  <Badge tone="red">{f.failed} fail</Badge>
                  <span className="w-12 text-right font-mono-data text-xs font-bold text-fail">
                    {Math.round(f.score * 100)}%
                  </span>
                </div>
              </Link>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
```

Note: the old `ShieldAlert` icon import is dropped along with the "Flaky-test deep dive" entry it was only used for — don't leave it as an unused import.

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 "src/app/(app)/reports/page.tsx"`
Strip if present.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/(app)/reports/page.tsx"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/reports/page.tsx"
git commit -m "Build out the Flaky-test deep dive: full cross-project list, replacing the stub card"
```

---

### Task 4: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated verification suite**

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
npx eslint src/lib/flaky-tests.ts src/lib/flaky-tests.test.ts "src/app/(app)/dashboard/page.tsx" "src/app/(app)/reports/page.tsx"
```
Expected: no output.

```bash
npm test
```
Expected: all existing unit tests pass, plus the new `src/lib/flaky-tests.test.ts` (6 tests).

```bash
npm run build
```
Expected: production build succeeds; `/reports` and `/` (dashboard) both still appear in the route list.

```bash
git status --short
```
Expected: clean.

- [ ] **Step 2: Manual smoke check in the browser**

1. Sign in as `qa.tester@meridianqa.dev` (org "TEST QA", project "Customer Portal Revamp" — seeded with test-case/run data).
2. Visit the dashboard (`/`). Confirm the "Flaky-test tracker" widget renders without error and its "See all →" link goes to `/reports`.
3. Visit `/reports`. Confirm the three still-stubbed cards (Pass/fail trend, Coverage by requirement, Team velocity) still render as "Coming soon", and the new "Flaky tests" section below them renders a real list (or the new empty-state copy, if the seeded data doesn't have any test case with ≥3 executions and a pass/fail mix in its last 10).
4. Click a flaky entry's title; confirm it navigates to that test case's detail page (`/projects/[projectId]/test-cases/[testCaseId]`) and 404s or errors nowhere.

If the seeded data doesn't naturally produce a flaky result, execute the same test case a few times with alternating pass/fail results via the Test Runner to produce one, then re-check.

- [ ] **Step 3: Confirm the design spec is fully addressed**

Re-read `docs/superpowers/specs/2026-08-17-flaky-test-detection-design.md`'s scope decisions and confirm each is reflected in the shipped code:
1. No schema changes — confirmed, no migration was created in this plan.
2. No paid gating — confirmed, no gating logic anywhere in `computeFlakyTests` or its consumers.
3. Placement is the cross-project `/reports` stub, not a new per-project tab — confirmed by Task 3.
4. Bounded 10-execution window, ≥3 minimum, no time-decay — confirmed by Task 1's implementation and tests.
5. Read-only — confirmed, no new Server Action, no new writable column.
6. JS pure function, not SQL — confirmed by Task 1.

- [ ] **Step 4: Commit the plan checkbox updates**

```bash
git add docs/superpowers/plans/2026-08-17-flaky-test-detection.md
git commit -m "docs: mark flaky test detection plan complete"
```
