# Test Bottleneck Identification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cross-project `/reports` page gains a "Blocked tests" section listing every currently-blocked run-case in an open run, sorted longest-stuck first.

**Architecture:** One new pure function, `computeBlockedTests` in `src/lib/blocked-tests.ts`, same no-I/O/unit-tested shape as `computeFlakyTests`. The `/reports` page's existing `test_run_cases` fetch (already powering the "Flaky tests" section) is extended with three more selected columns and a second row-mapping pass, feeding a new "Blocked tests" section below the existing one.

**Tech Stack:** Next.js 16 App Router (Server Component), Supabase (no schema change), TypeScript, Tailwind v4, Vitest, `date-fns` (already a dependency, first real usage in this codebase).

**Spec:** `docs/superpowers/specs/2026-08-21-test-bottleneck-identification-design.md` — read it first for the full rationale.

---

## Known repo quirk

Check `tail -3 <file>` after every file write for a stray literal `</content>` line; strip with `sed -i '' -e '/^<\/content>$/d' <file>` if present.

## Environment notes

- **git**: works in this session via `/Library/Developer/CommandLineTools/usr/bin/git` — prepend this to `PATH` before any git command (the default `git` on `PATH` hits an Xcode CLT license gate and fails).
- **Node/npm/npx**: unavailable in the authoring session. Every `Verify` step needing `tsc`/`eslint`/`build` needs an environment with Node — run it there, don't assume it already ran.

---

### Task 1: `computeBlockedTests` — the filter/sort function

**Files:**
- Create: `src/lib/blocked-tests.ts`
- Test: `src/lib/blocked-tests.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/blocked-tests.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeBlockedTests, type RawBlockedRunCaseRow } from "./blocked-tests";

// An overrides-object helper, not positional args like flaky-tests.test.ts's
// row() — RawBlockedRunCaseRow has 9 fields, more than reads cleanly
// positionally. Every test starts from this same "obviously blocked, obviously
// qualifies" baseline and overrides only what it's testing.
function row(overrides: Partial<RawBlockedRunCaseRow> = {}): RawBlockedRunCaseRow {
  return {
    testCaseId: "tc-1",
    title: "Test",
    projectId: "p-1",
    runId: "run-1",
    runName: "Run",
    runStatus: "in_progress",
    status: "blocked",
    executedAt: "2026-08-10T00:00:00Z",
    notes: null,
    ...overrides,
  };
}

describe("computeBlockedTests", () => {
  it("excludes a blocked row in a completed run", () => {
    expect(computeBlockedTests([row({ runStatus: "completed" })])).toEqual([]);
  });

  it("includes a blocked row in a planned or in_progress run", () => {
    const rows = [
      row({ runStatus: "planned" }),
      row({ testCaseId: "tc-2", runStatus: "in_progress" }),
    ];
    expect(computeBlockedTests(rows)).toHaveLength(2);
  });

  it("excludes non-blocked statuses regardless of run status", () => {
    const rows = [
      row({ status: "passed" }),
      row({ status: "failed" }),
      row({ status: "skipped" }),
      row({ status: "pending", executedAt: null }),
    ];
    expect(computeBlockedTests(rows)).toEqual([]);
  });

  it("sorts oldest-blocked first", () => {
    const rows = [
      row({ testCaseId: "tc-newer", executedAt: "2026-08-15T00:00:00Z" }),
      row({ testCaseId: "tc-older", executedAt: "2026-08-01T00:00:00Z" }),
    ];
    const result = computeBlockedTests(rows);
    expect(result.map((r) => r.testCaseId)).toEqual(["tc-older", "tc-newer"]);
  });

  it("passes a null notes value through unchanged", () => {
    const result = computeBlockedTests([row({ notes: null })]);
    expect(result[0].notes).toBeNull();
  });

  it("renames executedAt to blockedSince", () => {
    const result = computeBlockedTests([row({ executedAt: "2026-08-05T12:00:00Z" })]);
    expect(result[0].blockedSince).toBe("2026-08-05T12:00:00Z");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project unit src/lib/blocked-tests.test.ts`
Expected: FAIL — `src/lib/blocked-tests.ts` doesn't exist yet.

- [ ] **Step 3: Write `src/lib/blocked-tests.ts`**

```ts
export type BlockedRunStatus = "planned" | "in_progress" | "completed";
export type BlockedRunCaseStatus = "pending" | "passed" | "failed" | "blocked" | "skipped";

export interface RawBlockedRunCaseRow {
  testCaseId: string;
  title: string;
  projectId: string;
  runId: string;
  runName: string;
  runStatus: BlockedRunStatus;
  status: BlockedRunCaseStatus;
  executedAt: string | null;
  notes: string | null;
}

export interface BlockedTestEntry {
  testCaseId: string;
  title: string;
  projectId: string;
  runId: string;
  runName: string;
  blockedSince: string;
  notes: string | null;
}

const OPEN_RUN_STATUSES: BlockedRunStatus[] = ["planned", "in_progress"];

// Pure — no I/O. Takes the same shape of joined test_run_cases/test_runs rows
// the /reports page already fetches for the Flaky tests section, returns a
// filtered, sorted list of currently-blocked run-cases in still-open runs.
// See docs/superpowers/specs/2026-08-21-test-bottleneck-identification-design.md
// for the full rationale (no threshold, no time-decay — blocked is already a
// deliberate status, unlike flaky's noisy pass/fail history).
export function computeBlockedTests(rows: RawBlockedRunCaseRow[]): BlockedTestEntry[] {
  return rows
    .filter(
      (r): r is RawBlockedRunCaseRow & { executedAt: string } =>
        r.status === "blocked" && OPEN_RUN_STATUSES.includes(r.runStatus) && r.executedAt !== null
    )
    .sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime())
    .map((r) => ({
      testCaseId: r.testCaseId,
      title: r.title,
      projectId: r.projectId,
      runId: r.runId,
      runName: r.runName,
      blockedSince: r.executedAt,
      notes: r.notes,
    }));
}
```

- [ ] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 src/lib/blocked-tests.ts`
Strip with `sed -i '' -e '/^<\/content>$/d' src/lib/blocked-tests.ts` if present. Repeat for `src/lib/blocked-tests.test.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/lib/blocked-tests.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output. (Skip and note if Node isn't available.)

Run: `npx eslint src/lib/blocked-tests.ts src/lib/blocked-tests.test.ts`
Expected: no output. (Skip and note if Node isn't available.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/blocked-tests.ts src/lib/blocked-tests.test.ts
git commit -m "Add computeBlockedTests: long-stuck blocked run-cases in open runs, sorted oldest-first"
```

---

### Task 2: Add the "Blocked tests" section to `/reports`

**Files:**
- Modify: `src/app/(app)/reports/page.tsx`

- [ ] **Step 1: Replace the full file contents**

The current file (147 lines) has a "Flaky tests" section already, from earlier work this session. Replace the entire file with:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { BarChart3, GitBranch, Gauge } from "lucide-react";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { computeFlakyTests, type RawFlakyRunCaseRow } from "@/lib/flaky-tests";
import { computeBlockedTests, type RawBlockedRunCaseRow } from "@/lib/blocked-tests";

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
// page), so these do the same rather than assuming one shape.
function joinedTitle(rc: { test_cases: { title: string } | { title: string }[] | null }) {
  return Array.isArray(rc.test_cases) ? rc.test_cases[0]?.title : rc.test_cases?.title;
}
function joinedProjectId(rc: { test_runs: { project_id: string } | { project_id: string }[] | null }) {
  return Array.isArray(rc.test_runs) ? rc.test_runs[0]?.project_id : rc.test_runs?.project_id;
}
function joinedRun(rc: {
  test_runs:
    | { project_id: string; name: string; status: string }
    | { project_id: string; name: string; status: string }[]
    | null;
}) {
  return Array.isArray(rc.test_runs) ? rc.test_runs[0] : (rc.test_runs ?? undefined);
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
        .select(
          "status, test_case_id, run_id, executed_at, notes, test_cases(title), test_runs!inner(project_id, name, status)"
        )
        .in("test_runs.project_id", projectIds)
        .neq("status", "pending")
    : { data: [] as never[] };

  const testCaseProjectId = new Map<string, string>();
  const flakyRows: RawFlakyRunCaseRow[] = [];
  const blockedRows: RawBlockedRunCaseRow[] = [];
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

    const run = joinedRun(rc);
    if (run) {
      blockedRows.push({
        testCaseId: rc.test_case_id,
        title,
        projectId,
        runId: (rc as unknown as { run_id: string }).run_id,
        runName: run.name,
        runStatus: run.status as RawBlockedRunCaseRow["runStatus"],
        status: rc.status as RawBlockedRunCaseRow["status"],
        executedAt: (rc as unknown as { executed_at: string | null }).executed_at,
        notes: (rc as unknown as { notes: string | null }).notes,
      });
    }
  }

  const flaky = computeFlakyTests(flakyRows);
  const blocked = computeBlockedTests(blockedRows);

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

      <div className="mt-8">
        <h2 className="mb-3 font-headline-sm text-[17px] font-semibold text-ink-primary">
          Blocked tests
        </h2>
        <Card className="divide-y divide-border-light">
          {blocked.length === 0 && (
            <p className="p-4 text-sm text-ink-tertiary">No blocked tests right now.</p>
          )}
          {blocked.map((b) => (
            <Link
              key={`${b.runId}-${b.testCaseId}`}
              href={`/projects/${b.projectId}/runs/${b.runId}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-paper-surface"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-ui-label font-semibold text-ink-primary">
                  {b.title}
                </div>
                <div className="text-xs text-ink-tertiary">
                  {b.runName} · {projectNameById.get(b.projectId) ?? ""}
                </div>
                {b.notes && (
                  <div className="mt-1 truncate text-xs italic text-ink-tertiary">{b.notes}</div>
                )}
              </div>
              <span className="whitespace-nowrap text-xs font-semibold text-fail">
                {formatDistanceToNow(new Date(b.blockedSince), { addSuffix: true })}
              </span>
            </Link>
          ))}
        </Card>
      </div>
    </div>
  );
}
```

Note the new `key={`${b.runId}-${b.testCaseId}`}` (not just `testCaseId` like the Flaky tests list uses) — a test case can be blocked in more than one open run at once, so the compound key is required to stay unique.

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 "src/app/(app)/reports/page.tsx"`
Strip if present.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output. (Skip and note if Node isn't available.)

Run: `npx eslint "src/app/(app)/reports/page.tsx"`
Expected: no output. (Skip and note if Node isn't available.)

- [ ] **Step 4: Manual browser verification**

Needs a running dev server (`npm run dev`) and a signed-in session (`qa.tester@meridianqa.dev`, org "TEST QA"). Requires Node.

1. Create or find a test case, add it to a run that's still `planned` or `in_progress`, mark its result as "Blocked" in the Test Runner (with a note, to check the notes display).
2. Visit `/reports`. Confirm a "Blocked tests" section appears below "Flaky tests", showing that test case, the run's name, the project name, a relative "X ago" time, and the note.
3. Click the entry — confirm it navigates to that run's page (`/projects/[projectId]/runs/[runId]`), not the test case's own page.
4. Mark the same run-case as "Passed" instead (un-blocking it), or complete the run entirely, and reload `/reports`. Confirm the entry disappears.
5. If nothing is blocked, confirm the empty-state message ("No blocked tests right now.") renders instead of an empty or broken section.

If any of these fail, stop and report which one rather than marking this task done.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/reports/page.tsx"
git commit -m "Add Blocked tests section to /reports"
```

---

### Task 3: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated verification suite**

```bash
npx tsc --noEmit
```
Expected: no output. (Skip and note if Node isn't available.)

```bash
npx eslint src/lib/blocked-tests.ts src/lib/blocked-tests.test.ts "src/app/(app)/reports/page.tsx"
```
Expected: no output. (Skip and note if Node isn't available.)

```bash
npm test
```
Expected: all existing unit tests pass, plus the new `src/lib/blocked-tests.test.ts` (6 tests). (Skip and note if Node isn't available.)

```bash
npm run build
```
Expected: production build succeeds; `/reports` still appears in the route list. (Skip and note if Node isn't available.)

```bash
git status --short
```
Expected: clean.

- [ ] **Step 2: Confirm the design spec is fully addressed**

Re-read `docs/superpowers/specs/2026-08-21-test-bottleneck-identification-design.md`'s 6 scope decisions and confirm each is reflected:
1. Target is long-stuck blocked run-cases — confirmed, `computeBlockedTests` filters on `status === "blocked"` specifically.
2. Scoped to open runs only — confirmed, `OPEN_RUN_STATUSES` excludes `completed`.
3. No minimum threshold — confirmed, no threshold parameter anywhere in `computeBlockedTests`.
4. Placement on `/reports`, below Flaky tests — confirmed by Task 2.
5. No new schema — confirmed, no migration anywhere in this plan.
6. Reuses the existing `test_run_cases` fetch — confirmed, one query extended with three more columns, not a second query.

- [ ] **Step 3: Commit the plan checkbox updates**

```bash
git add docs/superpowers/plans/2026-08-21-test-bottleneck-identification.md
git commit -m "docs: mark test bottleneck identification plan complete"
```
