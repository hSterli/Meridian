# Pass/Fail Trend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cross-project `/reports` page's "Pass/fail trend" stub card becomes a real filled-area SVG chart of daily pass rate over the last 30 days, filterable by project.

**Architecture:** Two new pure functions — `computePassRateTrend` (data: rows → per-day pass rate) and `buildAreaChartPath` (geometry: per-day pass rate → SVG polyline/polygon point strings), kept in separate files so the data math and pixel math are independently testable. `/reports` gains a new date-bounded query, a project filter (reusing the dashboard's existing component), and a new chart section, replacing the stub card.

**Tech Stack:** Next.js 16 App Router (Server Component), Supabase, TypeScript, Tailwind v4, Vitest, hand-rolled SVG (no charting library).

**Spec:** `docs/superpowers/specs/2026-08-24-pass-fail-trend-design.md` — read it first for the full rationale.

**Design note not explicit in the spec, resolved here:** the spec's `days` parameter is described as existing "for testability," which only makes sense if the function has zero wall-clock dependency (no internal `new Date()` call) — otherwise tests would be non-deterministic. This plan implements `days` as a deterministic **post-grouping trim**: group all rows the function is given by date, then keep only the most recent `days` *distinct dates actually present in the data*. The real 30-day boundary is enforced once, server-side, by the page's new `.gte("executed_at", ...)` query (spec scope decision 8) — `days` in the pure function is a safety-net cap with no calendar-clock coupling, not a second enforcement of the same window.

---

## Known repo quirk

Check `tail -3 <file>` after every file write for a stray literal `</content>` line; strip with `sed -i '' -e '/^<\/content>$/d' <file>` if present.

## Environment notes

- **git**: works via `/Library/Developer/CommandLineTools/usr/bin/git` — prepend to `PATH` before any git command.
- **Node/npm/npx**: work via `/Users/heathersterling/.local/node-v24.19.0/bin` — prepend to `PATH` before any node/npm command. Run every Verify step for real.
- **Browser-pane preview tool is currently broken** (cross-wires to an unrelated sibling project's launch script) — don't route any Verify step through `preview_start`. The manual verification step below uses `npm run dev` directly and `curl`/reading rendered output instead.

---

### Task 1: `computePassRateTrend` — the data function

**Files:**
- Create: `src/lib/pass-rate-trend.ts`
- Test: `src/lib/pass-rate-trend.test.ts`

- [x] **Step 1: Write the failing tests**

Create `src/lib/pass-rate-trend.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computePassRateTrend, type RawTrendRunCaseRow } from "./pass-rate-trend";

function row(status: RawTrendRunCaseRow["status"], executedAt: string | null): RawTrendRunCaseRow {
  return { status, executedAt };
}

describe("computePassRateTrend", () => {
  it("scores a day with only passed rows as 1.0", () => {
    const rows = [row("passed", "2026-08-10T09:00:00Z"), row("passed", "2026-08-10T14:00:00Z")];
    expect(computePassRateTrend(rows)).toEqual([
      { date: "2026-08-10", passed: 2, failed: 0, passRate: 1 },
    ]);
  });

  it("scores a day with only failed rows as 0", () => {
    const rows = [row("failed", "2026-08-11T09:00:00Z")];
    expect(computePassRateTrend(rows)).toEqual([
      { date: "2026-08-11", passed: 0, failed: 1, passRate: 0 },
    ]);
  });

  it("omits a day whose only rows are blocked/skipped/pending, rather than scoring it 0", () => {
    const rows = [
      row("blocked", "2026-08-12T09:00:00Z"),
      row("skipped", "2026-08-12T10:00:00Z"),
      row("pending", null),
    ];
    expect(computePassRateTrend(rows)).toEqual([]);
  });

  it("groups multiple rows on the same UTC date into one entry", () => {
    const rows = [row("passed", "2026-08-13T00:30:00Z"), row("failed", "2026-08-13T23:30:00Z")];
    expect(computePassRateTrend(rows)).toEqual([
      { date: "2026-08-13", passed: 1, failed: 1, passRate: 0.5 },
    ]);
  });

  it("sorts entries ascending by date", () => {
    const rows = [
      row("passed", "2026-08-15T00:00:00Z"),
      row("passed", "2026-08-11T00:00:00Z"),
      row("passed", "2026-08-13T00:00:00Z"),
    ];
    const result = computePassRateTrend(rows);
    expect(result.map((r) => r.date)).toEqual(["2026-08-11", "2026-08-13", "2026-08-15"]);
  });

  it("trims to the most recent `days` distinct dates when more are present", () => {
    const rows = [
      row("passed", "2026-08-01T00:00:00Z"),
      row("passed", "2026-08-02T00:00:00Z"),
      row("passed", "2026-08-03T00:00:00Z"),
    ];
    const result = computePassRateTrend(rows, 2);
    expect(result.map((r) => r.date)).toEqual(["2026-08-02", "2026-08-03"]);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project unit src/lib/pass-rate-trend.test.ts`
Expected: FAIL — `src/lib/pass-rate-trend.ts` doesn't exist yet.

- [x] **Step 3: Write `src/lib/pass-rate-trend.ts`**

```ts
export type TrendRunCaseStatus = "pending" | "passed" | "failed" | "blocked" | "skipped";

export interface RawTrendRunCaseRow {
  status: TrendRunCaseStatus;
  executedAt: string | null;
}

export interface DailyPassRate {
  date: string; // YYYY-MM-DD
  passed: number;
  failed: number;
  passRate: number; // 0..1
}

const DEFAULT_DAYS = 30;

// Pure — no I/O, no wall-clock dependency. Groups passed/failed rows by
// their UTC calendar date and computes each day's pass rate. The real
// 30-day window is enforced once, server-side, by the caller's query
// (executed_at >= 30 days ago) — `days` here only trims the *output* to the
// most recent N distinct dates actually present in the input, so tests can
// exercise it deterministically without touching the system clock. See
// docs/superpowers/specs/2026-08-24-pass-fail-trend-design.md.
export function computePassRateTrend(
  rows: RawTrendRunCaseRow[],
  days: number = DEFAULT_DAYS
): DailyPassRate[] {
  const byDate = new Map<string, { passed: number; failed: number }>();

  for (const row of rows) {
    if (row.status !== "passed" && row.status !== "failed") continue;
    if (!row.executedAt) continue;

    const dateKey = row.executedAt.slice(0, 10);
    const entry = byDate.get(dateKey) ?? { passed: 0, failed: 0 };
    if (row.status === "passed") entry.passed += 1;
    else entry.failed += 1;
    byDate.set(dateKey, entry);
  }

  const sorted = Array.from(byDate.entries())
    .map(([date, { passed, failed }]) => ({
      date,
      passed,
      failed,
      passRate: passed / (passed + failed),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return sorted.length > days ? sorted.slice(sorted.length - days) : sorted;
}
```

- [x] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 src/lib/pass-rate-trend.ts`
Strip with `sed -i '' -e '/^<\/content>$/d' src/lib/pass-rate-trend.ts` if present. Repeat for the test file.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/lib/pass-rate-trend.test.ts`
Expected: 6 passed.

- [x] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/pass-rate-trend.ts src/lib/pass-rate-trend.test.ts`
Expected: no output.

- [x] **Step 7: Commit**

```bash
git add src/lib/pass-rate-trend.ts src/lib/pass-rate-trend.test.ts
git commit -m "Add computePassRateTrend: daily pass rate from passed/failed rows, most-recent-N-days trim"
```

---

### Task 2: `buildAreaChartPath` — the chart geometry function

**Files:**
- Create: `src/lib/pass-rate-chart-geometry.ts`
- Test: `src/lib/pass-rate-chart-geometry.test.ts`

- [x] **Step 1: Write the failing tests**

Create `src/lib/pass-rate-chart-geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAreaChartPath } from "./pass-rate-chart-geometry";
import type { DailyPassRate } from "./pass-rate-trend";

function entry(date: string, passRate: number): DailyPassRate {
  return { date, passed: 0, failed: 0, passRate };
}

describe("buildAreaChartPath", () => {
  it("returns empty strings for no entries", () => {
    expect(buildAreaChartPath([], 600, 150)).toEqual({ linePoints: "", areaPoints: "" });
  });

  it("draws a flat line across the full width for a single entry", () => {
    const result = buildAreaChartPath([entry("2026-08-10", 0.5)], 600, 150);
    expect(result.linePoints).toBe("0,75 600,75");
    expect(result.areaPoints).toBe("0,75 600,75 600,150 0,150");
  });

  it("places a 100% pass rate at the top (y=0) and 0% at the bottom (y=height)", () => {
    const result = buildAreaChartPath([entry("2026-08-10", 1), entry("2026-08-11", 0)], 600, 150);
    expect(result.linePoints).toBe("0,0 600,150");
  });

  it("spaces multiple points evenly across the width", () => {
    const result = buildAreaChartPath(
      [entry("2026-08-10", 1), entry("2026-08-11", 1), entry("2026-08-12", 1)],
      600,
      150
    );
    expect(result.linePoints).toBe("0,0 300,0 600,0");
  });

  it("closes the area polygon down to the baseline and back to the start", () => {
    const result = buildAreaChartPath([entry("2026-08-10", 1), entry("2026-08-11", 0)], 600, 150);
    expect(result.areaPoints).toBe("0,0 600,150 600,150 0,150");
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project unit src/lib/pass-rate-chart-geometry.test.ts`
Expected: FAIL — `src/lib/pass-rate-chart-geometry.ts` doesn't exist yet.

- [x] **Step 3: Write `src/lib/pass-rate-chart-geometry.ts`**

```ts
import type { DailyPassRate } from "./pass-rate-trend";

export interface AreaChartPaths {
  linePoints: string;
  areaPoints: string;
}

// Pure — converts a list of daily pass rates into SVG <polyline>/<polygon>
// `points` attribute strings, plotted left-to-right (oldest to newest,
// since computePassRateTrend already returns them sorted ascending).
// passRate 1 (100%) maps to y=0 (top); passRate 0 maps to y=height
// (bottom) — standard "up is good" chart orientation.
export function buildAreaChartPath(
  entries: DailyPassRate[],
  width: number,
  height: number
): AreaChartPaths {
  if (entries.length === 0) {
    return { linePoints: "", areaPoints: "" };
  }

  if (entries.length === 1) {
    const y = height - entries[0].passRate * height;
    const linePoints = `0,${y} ${width},${y}`;
    return { linePoints, areaPoints: `${linePoints} ${width},${height} 0,${height}` };
  }

  const stepX = width / (entries.length - 1);
  const linePoints = entries
    .map((e, i) => {
      const x = i * stepX;
      const y = height - e.passRate * height;
      return `${x},${y}`;
    })
    .join(" ");

  return { linePoints, areaPoints: `${linePoints} ${width},${height} 0,${height}` };
}
```

- [x] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 src/lib/pass-rate-chart-geometry.ts`
Strip if present. Repeat for the test file.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/lib/pass-rate-chart-geometry.test.ts`
Expected: 5 passed.

- [x] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/pass-rate-chart-geometry.ts src/lib/pass-rate-chart-geometry.test.ts`
Expected: no output.

- [x] **Step 7: Commit**

```bash
git add src/lib/pass-rate-chart-geometry.ts src/lib/pass-rate-chart-geometry.test.ts
git commit -m "Add buildAreaChartPath: daily pass rates to SVG polyline/polygon points"
```

---

### Task 3: Wire the chart and project filter into `/reports`

**Files:**
- Modify: `src/app/(app)/reports/page.tsx`

- [x] **Step 1: Replace the full file contents**

The current file (208 lines) has 3 stub cards, a Flaky tests section, and a Blocked tests section, with no project-filtering logic anywhere. Replace the entire file with:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { GitBranch, Gauge } from "lucide-react";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { DashboardProjectFilter } from "@/components/dashboard/project-filter";
import { computeFlakyTests, type RawFlakyRunCaseRow } from "@/lib/flaky-tests";
import { computeBlockedTests, type RawBlockedRunCaseRow } from "@/lib/blocked-tests";
import { computePassRateTrend, type RawTrendRunCaseRow } from "@/lib/pass-rate-trend";
import { buildAreaChartPath } from "@/lib/pass-rate-chart-geometry";

const PLANNED_REPORTS = [
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

const CHART_WIDTH = 600;
const CHART_HEIGHT = 150;

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

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const { project: selectedProjectId } = await searchParams;

  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("org_id", ctx.activeOrgId);

  const allProjectIds = (projects ?? []).map((p) => p.id);
  const isValidSelection = !!selectedProjectId && allProjectIds.includes(selectedProjectId);
  const projectIds = isValidSelection ? [selectedProjectId] : allProjectIds;
  const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.name]));

  const filterAction = (
    <DashboardProjectFilter projects={(projects ?? []).map((p) => ({ id: p.id, name: p.name }))} />
  );

  const { data: runCases } = projectIds.length
    ? await supabase
        .from("test_run_cases")
        .select(
          "status, test_case_id, run_id, executed_at, notes, test_cases(title), test_runs!inner(project_id, name, status)"
        )
        .in("test_runs.project_id", projectIds)
        .neq("status", "pending")
    : { data: [] as never[] };

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

  const { data: trendRunCases } = projectIds.length
    ? await supabase
        .from("test_run_cases")
        .select("status, executed_at, test_runs!inner(project_id)")
        .in("test_runs.project_id", projectIds)
        .gte("executed_at", thirtyDaysAgo.toISOString())
        .in("status", ["passed", "failed"])
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

  const trendRows: RawTrendRunCaseRow[] = (trendRunCases ?? []).map((rc) => ({
    status: rc.status as RawTrendRunCaseRow["status"],
    executedAt: (rc as unknown as { executed_at: string | null }).executed_at,
  }));

  const flaky = computeFlakyTests(flakyRows);
  const blocked = computeBlockedTests(blockedRows);
  const trend = computePassRateTrend(trendRows);
  const { linePoints, areaPoints } = buildAreaChartPath(trend, CHART_WIDTH, CHART_HEIGHT);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Reports"
        description="The dashboard already covers cross-project pass/fail trend and the flaky-test tracker. Deeper, exportable report templates are coming next."
        action={filterAction}
      />

      <div className="mt-2">
        <h2 className="mb-3 font-headline-sm text-[17px] font-semibold text-ink-primary">
          Pass/fail trend
        </h2>
        <Card className="p-5">
          {trend.length === 0 ? (
            <p className="text-sm text-ink-tertiary">No pass/fail results in the last 30 days yet.</p>
          ) : (
            <>
              <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-[150px] w-full">
                <defs>
                  <linearGradient id="passRateFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1e8a5b" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#1e8a5b" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polygon fill="url(#passRateFill)" points={areaPoints} />
                <polyline
                  fill="none"
                  stroke="#1e8a5b"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={linePoints}
                />
              </svg>
              <div className="mt-2 flex justify-between text-xs text-ink-tertiary">
                <span>{trend[0].date}</span>
                <span>{trend[trend.length - 1].date}</span>
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
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

Notes on this change:
- `BarChart3` is dropped from the `lucide-react` import — it was only used for the now-removed "Pass/fail trend" stub entry.
- The project filter (`DashboardProjectFilter`) is added to the page's `PageHeader` action slot, which **also scopes the existing Flaky tests and Blocked tests sections** (both already query via `projectIds`, which now responds to `?project=` instead of always being every org project). This is a deliberate, natural side effect — once a project-filter control exists on the page, leaving two of the three sections unfiltered while only the new chart responds to it would be inconsistent UX. It is not scope creep on the *data model* (no new query shape for Flaky/Blocked tests, just a narrower `projectIds` input to the query they already run).
- The trend section reuses the exact `#1e8a5b` pass-green from the approved visual mockup.

- [x] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 "src/app/(app)/reports/page.tsx"`
Strip if present.

- [x] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output. If it reports a type error specifically on `rc.executed_at` or `rc.status` inside the new `trendRows` mapping, this means the simpler direct-typed approach doesn't hold for this particular select shape — apply the same `(rc as unknown as { executed_at: string | null }).executed_at` cast pattern already used for the Flaky/Blocked-tests mappings immediately above it in this same file (the code above already does this defensively; if tsc is clean, no change needed).

Run: `npx eslint "src/app/(app)/reports/page.tsx"`
Expected: no output.

- [x] **Step 4: Manual verification via the dev server**

The Browser-pane preview tool is broken this session — verify directly instead:

```bash
export PATH="/Users/heathersterling/.local/node-v24.19.0/bin:$PATH"
cd /Users/heathersterling/Documents/CLAUDE/PROJECTS/Meridian
npm run dev &
sleep 3
curl -s -o /tmp/reports-page.html -w "%{http_code}\n" http://localhost:3000/reports
grep -c "Pass/fail trend" /tmp/reports-page.html
grep -c "svg" /tmp/reports-page.html
kill %1
```

Expected: HTTP status is `200` or a redirect (`307`/`302` to `/login` is also fine if not authenticated in this shell — it proves the route compiles and responds, which is what this check is for); if `200`, `"Pass/fail trend"` and an `<svg` tag should both appear in the response body. If port 3000 is already in use by something else, adjust to a free port with `PORT=3100 npm run dev &` and curl that port instead. This is a compile/render smoke check, not a substitute for looking at it in an actual browser — note in your report that a real visual check (does the chart look right, is the fill visible, does the project filter work) still needs a human or a working preview tool.

- [x] **Step 5: Commit**

```bash
git add "src/app/(app)/reports/page.tsx"
git commit -m "Build out the Pass/fail trend chart on /reports, with a project filter"
```

---

### Task 4: Full verification pass

**Files:** none (verification only)

- [x] **Step 1: Run the full automated verification suite**

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
npx eslint src/lib/pass-rate-trend.ts src/lib/pass-rate-trend.test.ts src/lib/pass-rate-chart-geometry.ts src/lib/pass-rate-chart-geometry.test.ts "src/app/(app)/reports/page.tsx"
```
Expected: no output.

```bash
npm test
```
Expected: all existing tests pass, plus the 6 new `pass-rate-trend.test.ts` tests and 5 new `pass-rate-chart-geometry.test.ts` tests.

```bash
npm run build
```
Expected: production build succeeds; `/reports` still appears in the route list.

```bash
git status --short
```
Expected: clean.

- [x] **Step 2: Confirm the design spec is fully addressed**

Re-read `docs/superpowers/specs/2026-08-24-pass-fail-trend-design.md`'s 8 scope decisions and confirm each is reflected:
1. Daily buckets, 30-day lookback — confirmed by the `.gte("executed_at", thirtyDaysAgo...)` query in Task 3.
2. Project filter mirroring the dashboard's pattern — confirmed, `DashboardProjectFilter` reused directly, `?project=` resolution logic mirrors `dashboard/page.tsx` exactly.
3. Actual chart, not a table — confirmed, SVG polygon/polyline.
4. Hand-rolled SVG, no library — confirmed, no new `package.json` dependency anywhere in this plan.
5. Filled area chart style — confirmed, gradient fill + polyline matching the approved mockup.
6. `passed / (passed + failed)` pass rate definition — confirmed in `computePassRateTrend`.
7. Zero-result days omitted, not zeroed — confirmed by Task 1's test 3.
8. Own date-bounded query, not a reuse of the Flaky/Blocked-tests fetch — confirmed, `trendRunCases` is a separate query from `runCases`.

- [x] **Step 3: Commit the plan checkbox updates**

```bash
git add docs/superpowers/plans/2026-08-24-pass-fail-trend.md
git commit -m "docs: mark pass/fail trend plan complete"
```
