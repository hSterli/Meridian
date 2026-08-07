# Weekly Status Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Note for this repo**: neither named sub-skill is installed here — execute via a fresh general-purpose subagent per task, with the orchestrator reviewing each task's actual diff before dispatching the next (same approach used for every prior plan this session).

**Goal:** Give each Meridian project a live "Weekly Status Report" dashboard (project info, RAG status, key metrics, daily execution table, module breakdown) built on existing test/issue data, plus a non-destructive snapshot mechanism so a report can be captured and shared without its numbers silently changing later.

**Architecture:** Three new tables (`weekly_report_drafts` for always-current editorial state, `weekly_report_daily_plans` for manually-entered planned counts, `weekly_report_snapshots` for permanent append-only captures) plus a pure aggregation function (`aggregateWeeklyMetrics`) that turns raw test-case/run-case/issue rows into the report's metrics shape — used identically by the live dashboard and by snapshot capture, so there's exactly one place the math lives. New "Reports" tab alongside Test Cases/Suites/Runs/Issues.

**Tech Stack:** Next.js 16 Server Actions/Server Components, Supabase (Postgres/RLS), TypeScript, Tailwind v4 (reusing the existing `Badge` component's `green`/`red`/`amber` tones for RAG — no new colors needed), Vitest for the pure aggregation logic.

**Known repo quirk to watch for:** every `Write` tool call in this project has a history of appending a stray literal `</content>` line at the end of the file. After every `Write` call below, run `tail -3 <file>` to check for it and strip it with `sed -i '' -e '/^<\/content>$/d' <file>` if present, before moving on.

**Migration numbering note:** as of this plan being written, the live migration count is 18 (`0018_lock_down_jira_functions.sql` is the latest applied). A separate, not-yet-executed plan (`docs/superpowers/plans/2026-08-04-run-evidence-attachments.md`) has already claimed migration number `0019` for itself in its own committed Task 1. To avoid a numbering collision regardless of which plan executes first, **this plan's migration is `0020`**. Before running Task 1 below, run `ls supabase/migrations/ | tail -5` to confirm the actual current state — if `0019_link_attachments_to_run_cases.sql` already exists (that other plan ran first), proceed with `0020` as planned; if for some reason `0020` is *also* already taken by the time you execute this, use the next free number instead and note the deviation when reporting back.

**Test infrastructure note:** as of this writing, `tests/integration/` doesn't exist yet (a separate, parallel automated-test-suite plan is mid-execution and hasn't reached that task). Check `ls tests/integration/` at the start of any task that would ideally have an integration test — if it still doesn't exist, use the same substitution every earlier plan in this repo used before a runner existed: `npx tsc --noEmit` and `npx eslint <file>` as the "step passes" signal, plus a manual verification instruction. Vitest unit tests (`npm test`, `src/**/*.test.ts`) already work and should be used for real wherever this plan has pure logic to test.

**Supabase project ref for MCP tools:** `ucnfcsosbdgknmzyuqbw` (same live project used by every prior migration this session).

---

### Task 1: Migration — weekly report tables

**Files:**
- Create: `supabase/migrations/0020_weekly_status_reports.sql`

- [x] **Step 1: Confirm the next free migration number**

Run: `ls supabase/migrations/ | tail -5`
Expected per the note above: `0020` is free. If not, adjust the filename and every reference to it in this task before continuing, and note the deviation when reporting back.

- [x] **Step 2: Write the migration**

Create `supabase/migrations/0020_weekly_status_reports.sql`:

```sql
-- Weekly Status Report: a live, always-current dashboard per project, plus
-- a non-destructive snapshot mechanism so a report that's been shared
-- externally has a trustworthy historical record. See
-- docs/superpowers/specs/2026-08-04-weekly-status-report-design.md.

create type report_rag_status as enum ('red', 'amber', 'green');

-- The single, always-current editorial state for a project's weekly report.
-- Overwritten in place as the analyst edits through the week — no history
-- needed here, since snapshots are what preserve history.
create table weekly_report_drafts (
  project_id uuid primary key references projects(id) on delete cascade,
  rag_status report_rag_status not null default 'green',
  highlights text not null default '',
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table weekly_report_drafts enable row level security;

create policy "members can view weekly report drafts" on weekly_report_drafts
  for select using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can upsert weekly report drafts" on weekly_report_drafts
  for insert with check (private.is_org_member(private.project_org_id(project_id)));
create policy "members can update weekly report drafts" on weekly_report_drafts
  for update using (private.is_org_member(private.project_org_id(project_id)));

-- Planned execution count per calendar date. Persists independently of any
-- snapshot; old dates just become historical once the week moves on.
create table weekly_report_daily_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  plan_date date not null,
  planned_count integer not null default 0,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (project_id, plan_date)
);

create index weekly_report_daily_plans_project_id_idx on weekly_report_daily_plans(project_id);

alter table weekly_report_daily_plans enable row level security;

create policy "members can view daily plans" on weekly_report_daily_plans
  for select using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can upsert daily plans" on weekly_report_daily_plans
  for insert with check (private.is_org_member(private.project_org_id(project_id)));
create policy "members can update daily plans" on weekly_report_daily_plans
  for update using (private.is_org_member(private.project_org_id(project_id)));

-- Permanent, append-only captures. metrics/daily_planned are frozen forever;
-- rag_status/highlights may be corrected in place after capture (enforced
-- at the Server Action layer, not RLS — see uploadAttachment-style comment
-- in the Server Actions task below).
create table weekly_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  week_ending date not null,
  rag_status report_rag_status not null,
  highlights text not null,
  metrics jsonb not null,
  daily_planned jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index weekly_report_snapshots_project_id_idx on weekly_report_snapshots(project_id);
create index weekly_report_snapshots_project_week_idx on weekly_report_snapshots(project_id, week_ending);

alter table weekly_report_snapshots enable row level security;

create policy "members can view snapshots" on weekly_report_snapshots
  for select using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can create snapshots" on weekly_report_snapshots
  for insert with check (private.is_org_member(private.project_org_id(project_id)));
create policy "members can edit snapshot editorial fields" on weekly_report_snapshots
  for update using (private.is_org_member(private.project_org_id(project_id)));
```

- [x] **Step 3: Apply the migration to the live project**

Use the Supabase MCP `apply_migration` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`, `name: "weekly_status_reports"`, and the SQL above as `query`.

- [x] **Step 4: Verify the tables exist and RLS is on**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select relname, relrowsecurity
from pg_class
where relname in ('weekly_report_drafts', 'weekly_report_daily_plans', 'weekly_report_snapshots');
```

Expected: three rows, all `relrowsecurity = true`.

- [x] **Step 5: Run the security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`. Expected: the same pre-existing, already-reviewed items as before this migration (rate_limit_buckets RLS-no-policy, SECURITY DEFINER warnings, leaked-password-protection) — no new items, since every new table here has RLS enabled with real policies.

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/0020_weekly_status_reports.sql
git commit -m "Add weekly status report tables (drafts, daily plans, snapshots)"
```

---

### Task 2: Regenerate TypeScript types

**Files:**
- Modify: `src/lib/types/database.ts`

- [x] **Step 1: Regenerate types from the live schema**

Use the Supabase MCP `generate_typescript_types` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`.

- [x] **Step 2: Add the three new table blocks to `database.ts`**

In the `Tables` block, insert each new table alphabetically among the existing entries (matching this file's existing alphabetical ordering of table keys):

```ts
      weekly_report_daily_plans: {
        Row: {
          id: string
          plan_date: string
          planned_count: number
          project_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          id?: string
          plan_date: string
          planned_count?: number
          project_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          id?: string
          plan_date?: string
          planned_count?: number
          project_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_report_daily_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_report_drafts: {
        Row: {
          highlights: string
          project_id: string
          rag_status: Database["public"]["Enums"]["report_rag_status"]
          updated_at: string
          updated_by: string
        }
        Insert: {
          highlights?: string
          project_id: string
          rag_status?: Database["public"]["Enums"]["report_rag_status"]
          updated_at?: string
          updated_by: string
        }
        Update: {
          highlights?: string
          project_id?: string
          rag_status?: Database["public"]["Enums"]["report_rag_status"]
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_report_drafts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_report_snapshots: {
        Row: {
          created_at: string
          created_by: string
          daily_planned: Json
          highlights: string
          id: string
          metrics: Json
          project_id: string
          rag_status: Database["public"]["Enums"]["report_rag_status"]
          week_ending: string
        }
        Insert: {
          created_at?: string
          created_by: string
          daily_planned: Json
          highlights: string
          id?: string
          metrics: Json
          project_id: string
          rag_status: Database["public"]["Enums"]["report_rag_status"]
          week_ending: string
        }
        Update: {
          created_at?: string
          created_by?: string
          daily_planned?: Json
          highlights?: string
          id?: string
          metrics?: Json
          project_id?: string
          rag_status?: Database["public"]["Enums"]["report_rag_status"]
          week_ending?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_report_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [x] **Step 3: Add the new enum**

In the `Enums` block (alongside `issue_severity`, `run_status`, etc.), add:

```ts
      report_rag_status: "red" | "amber" | "green"
```

And in the `Constants` block at the bottom of the file (where enum value arrays are listed, alongside `issue_severity: [...]`), add:

```ts
      report_rag_status: ["red", "amber", "green"],
```

- [x] **Step 4: Add the convenience type export**

Near the bottom of the file, alongside `export type RunCaseStatus = Enums<"run_case_status">;`, add:

```ts
export type ReportRagStatus = Enums<"report_rag_status">;
```

- [x] **Step 5: Verify the type compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [x] **Step 6: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "Regenerate types for weekly report tables"
```

---

### Task 3: Pure metrics aggregation logic (real TDD)

**Files:**
- Create: `src/lib/weekly-report-metrics.ts`
- Test: `src/lib/weekly-report-metrics.test.ts`

- [x] **Step 1: Write the failing tests**

Create `src/lib/weekly-report-metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aggregateWeeklyMetrics, getWeekdayRange } from "./weekly-report-metrics";

describe("getWeekdayRange", () => {
  it("returns Monday through Friday of the week containing the given date", () => {
    // 2026-08-05 is a Wednesday
    expect(getWeekdayRange(new Date("2026-08-05T12:00:00Z"))).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
  });

  it("returns the same week for a Monday as for the Friday of that week", () => {
    expect(getWeekdayRange(new Date("2026-08-03T12:00:00Z"))).toEqual(
      getWeekdayRange(new Date("2026-08-07T12:00:00Z"))
    );
  });

  it("rolls a Sunday forward to the following week's Monday-Friday", () => {
    // 2026-08-09 is a Sunday
    expect(getWeekdayRange(new Date("2026-08-09T12:00:00Z"))[0]).toBe("2026-08-10");
  });
});

describe("aggregateWeeklyMetrics", () => {
  const weekDates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];

  it("handles a project with no test cases at all", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [],
      runCases: [],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: {},
    });
    expect(result.totalTestCases).toBe(0);
    expect(result.executed).toBe(0);
    expect(result.percentComplete).toBe(0);
    expect(result.passRate).toBe(0);
    expect(result.moduleBreakdown).toEqual([]);
    expect(result.dailyExecution).toHaveLength(5);
    expect(result.dailyExecution[0]).toEqual({
      date: "2026-08-03",
      planned: 0,
      actual: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
    });
  });

  it("counts total and executed test cases, and computes pass rate from the latest status per case", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [
        { id: "tc-1", featureName: "Login" },
        { id: "tc-2", featureName: "Login" },
        { id: "tc-3", featureName: "Checkout" },
      ],
      runCases: [
        { testCaseId: "tc-1", status: "passed", executedAt: "2026-08-04T10:00:00Z" },
        { testCaseId: "tc-2", status: "failed", executedAt: "2026-08-05T10:00:00Z" },
        // tc-3 has never been executed
      ],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: {},
    });
    expect(result.totalTestCases).toBe(3);
    expect(result.executed).toBe(2);
    expect(result.percentComplete).toBeCloseTo(2 / 3);
    expect(result.passRate).toBeCloseTo(1 / 2);
  });

  it("uses only the most recent execution per test case, not every attempt", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [{ id: "tc-1", featureName: "Login" }],
      runCases: [
        { testCaseId: "tc-1", status: "failed", executedAt: "2026-08-03T09:00:00Z" },
        { testCaseId: "tc-1", status: "passed", executedAt: "2026-08-05T09:00:00Z" },
      ],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: {},
    });
    expect(result.executed).toBe(1);
    expect(result.passRate).toBe(1);
    const login = result.moduleBreakdown.find((m) => m.feature === "Login");
    expect(login?.passed).toBe(1);
    expect(login?.failed).toBe(0);
  });

  it("groups the module breakdown by feature, bucketing null feature as Unassigned", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [
        { id: "tc-1", featureName: "Login" },
        { id: "tc-2", featureName: null },
      ],
      runCases: [
        { testCaseId: "tc-1", status: "passed", executedAt: "2026-08-04T10:00:00Z" },
        { testCaseId: "tc-2", status: "blocked", executedAt: "2026-08-04T10:00:00Z" },
      ],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: {},
    });
    const unassigned = result.moduleBreakdown.find((m) => m.feature === "Unassigned");
    expect(unassigned?.total).toBe(1);
    expect(unassigned?.blocked).toBe(1);
  });

  it("buckets every execution event within the week by its own date, even repeat runs of the same case", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [{ id: "tc-1", featureName: "Login" }],
      runCases: [
        { testCaseId: "tc-1", status: "failed", executedAt: "2026-08-03T09:00:00Z" },
        { testCaseId: "tc-1", status: "passed", executedAt: "2026-08-04T09:00:00Z" },
      ],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: { "2026-08-03": 5, "2026-08-04": 5 },
    });
    const mon = result.dailyExecution.find((d) => d.date === "2026-08-03");
    const tue = result.dailyExecution.find((d) => d.date === "2026-08-04");
    expect(mon).toEqual({ date: "2026-08-03", planned: 5, actual: 1, passed: 0, failed: 1, blocked: 0 });
    expect(tue).toEqual({ date: "2026-08-04", planned: 5, actual: 1, passed: 1, failed: 0, blocked: 0 });
  });

  it("ignores executions outside the given week when building the daily table", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [{ id: "tc-1", featureName: "Login" }],
      runCases: [{ testCaseId: "tc-1", status: "passed", executedAt: "2026-07-20T09:00:00Z" }],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: {},
    });
    expect(result.dailyExecution.every((d) => d.actual === 0)).toBe(true);
    // still counts toward the cumulative totals, since those aren't week-scoped
    expect(result.executed).toBe(1);
  });

  it("passes open defect counts through unchanged", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [],
      runCases: [],
      openDefects: 11,
      criticalHighOpen: 1,
      weekDates,
      plannedByDate: {},
    });
    expect(result.openDefects).toBe(11);
    expect(result.criticalHighOpen).toBe(1);
  });
});
```

Check for the stray `</content>` line: `tail -3 src/lib/weekly-report-metrics.test.ts`.

- [x] **Step 2: Run the tests to confirm they fail**

Run: `npm test`
Expected: FAIL — `src/lib/weekly-report-metrics.ts` doesn't exist yet.

- [x] **Step 3: Write the implementation**

Create `src/lib/weekly-report-metrics.ts`:

```ts
export interface RawTestCaseRow {
  id: string;
  featureName: string | null;
}

export type RunCaseStatusValue = "pending" | "passed" | "failed" | "blocked" | "skipped";

export interface RawRunCaseRow {
  testCaseId: string;
  status: RunCaseStatusValue;
  executedAt: string | null;
}

export interface DailyExecutionEntry {
  date: string;
  planned: number;
  actual: number;
  passed: number;
  failed: number;
  blocked: number;
}

export interface ModuleBreakdownEntry {
  feature: string;
  total: number;
  executed: number;
  passed: number;
  failed: number;
  blocked: number;
}

export interface WeeklyMetrics {
  totalTestCases: number;
  executed: number;
  percentComplete: number;
  passRate: number;
  openDefects: number;
  criticalHighOpen: number;
  dailyExecution: DailyExecutionEntry[];
  moduleBreakdown: ModuleBreakdownEntry[];
}

export interface AggregateWeeklyMetricsInput {
  testCases: RawTestCaseRow[];
  runCases: RawRunCaseRow[];
  openDefects: number;
  criticalHighOpen: number;
  weekDates: string[];
  plannedByDate: Record<string, number>;
}

const UNASSIGNED_FEATURE = "Unassigned";

function latestExecutedStatusByTestCase(
  runCases: RawRunCaseRow[]
): Map<string, RawRunCaseRow> {
  const latest = new Map<string, RawRunCaseRow>();
  for (const rc of runCases) {
    if (!rc.executedAt) continue;
    const existing = latest.get(rc.testCaseId);
    if (!existing || !existing.executedAt || rc.executedAt > existing.executedAt) {
      latest.set(rc.testCaseId, rc);
    }
  }
  return latest;
}

export function aggregateWeeklyMetrics(input: AggregateWeeklyMetricsInput): WeeklyMetrics {
  const { testCases, runCases, openDefects, criticalHighOpen, weekDates, plannedByDate } = input;

  const latestByTestCase = latestExecutedStatusByTestCase(runCases);
  const totalTestCases = testCases.length;
  const executed = latestByTestCase.size;
  const passed = Array.from(latestByTestCase.values()).filter((rc) => rc.status === "passed").length;

  const moduleMap = new Map<string, ModuleBreakdownEntry>();
  for (const tc of testCases) {
    const feature = tc.featureName ?? UNASSIGNED_FEATURE;
    if (!moduleMap.has(feature)) {
      moduleMap.set(feature, { feature, total: 0, executed: 0, passed: 0, failed: 0, blocked: 0 });
    }
    const entry = moduleMap.get(feature)!;
    entry.total += 1;
    const latest = latestByTestCase.get(tc.id);
    if (latest) {
      entry.executed += 1;
      if (latest.status === "passed") entry.passed += 1;
      if (latest.status === "failed") entry.failed += 1;
      if (latest.status === "blocked") entry.blocked += 1;
    }
  }

  const dailyExecution: DailyExecutionEntry[] = weekDates.map((date) => {
    const dayRunCases = runCases.filter((rc) => rc.executedAt && rc.executedAt.slice(0, 10) === date);
    return {
      date,
      planned: plannedByDate[date] ?? 0,
      actual: dayRunCases.length,
      passed: dayRunCases.filter((rc) => rc.status === "passed").length,
      failed: dayRunCases.filter((rc) => rc.status === "failed").length,
      blocked: dayRunCases.filter((rc) => rc.status === "blocked").length,
    };
  });

  return {
    totalTestCases,
    executed,
    percentComplete: totalTestCases === 0 ? 0 : executed / totalTestCases,
    passRate: executed === 0 ? 0 : passed / executed,
    openDefects,
    criticalHighOpen,
    dailyExecution,
    moduleBreakdown: Array.from(moduleMap.values()),
  };
}

export function getWeekdayRange(referenceDate: Date): string[] {
  const day = referenceDate.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? 1 : 1 - day;
  const monday = new Date(referenceDate);
  monday.setUTCDate(referenceDate.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);

  const dates: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}
```

Check for the stray `</content>` line: `tail -3 src/lib/weekly-report-metrics.ts`.

`latestExecutedStatusByTestCase` and the module/daily aggregation deliberately don't distinguish *which run* a status came from — only the most recent `executedAt` timestamp across all of a project's runs wins, matching how the source spec's sample data reads (cumulative progress toward the whole test cycle, not scoped to one run). `dailyExecution`, by contrast, counts every execution event whose date falls in the target week, even if the same test case was run more than once that week — it's a log of daily activity, not a deduped per-case status.

- [x] **Step 4: Run the tests to confirm they pass**

Run: `npm test`
Expected: PASS — all tests in `src/lib/weekly-report-metrics.test.ts` green.

- [x] **Step 5: Verify nothing else broke**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/weekly-report-metrics.ts src/lib/weekly-report-metrics.test.ts`
Expected: no output.

- [x] **Step 6: Commit**

```bash
git add src/lib/weekly-report-metrics.ts src/lib/weekly-report-metrics.test.ts
git commit -m "Add pure weekly report metrics aggregation with unit tests"
```

---

### Task 4: Database-querying wrapper

**Files:**
- Modify: `src/lib/weekly-report-metrics.ts`

- [x] **Step 1: Add the Supabase-querying wrapper**

Append to `src/lib/weekly-report-metrics.ts` (same file — this function calls the pure `aggregateWeeklyMetrics` above, but itself does real queries, so it isn't unit-testable the same way; it stays in this file rather than the actions file so it has no `"use server"` directive and can be called freely from Server Components):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export async function computeWeeklyReportMetrics(
  supabase: SupabaseClient<Database>,
  projectId: string,
  weekDates: string[]
): Promise<WeeklyMetrics> {
  const { data: testCaseRows } = await supabase
    .from("test_cases")
    .select("id, test_case_features(name)")
    .eq("project_id", projectId);

  const testCases: RawTestCaseRow[] = (testCaseRows ?? []).map((tc) => {
    const linkedFeature = tc.test_case_features as { name: string } | { name: string }[] | null;
    const feature = Array.isArray(linkedFeature) ? linkedFeature[0]?.name : linkedFeature?.name;
    return { id: tc.id, featureName: feature ?? null };
  });

  const { data: runRows } = await supabase.from("test_runs").select("id").eq("project_id", projectId);
  const runIds = (runRows ?? []).map((r) => r.id);

  let runCases: RawRunCaseRow[] = [];
  if (runIds.length > 0) {
    const { data: runCaseRows } = await supabase
      .from("test_run_cases")
      .select("test_case_id, status, executed_at")
      .in("run_id", runIds);
    runCases = (runCaseRows ?? []).map((rc) => ({
      testCaseId: rc.test_case_id,
      status: rc.status,
      executedAt: rc.executed_at,
    }));
  }

  const { data: openIssues } = await supabase
    .from("issues")
    .select("severity")
    .eq("project_id", projectId)
    .in("status", ["open", "in_progress"]);

  const openDefects = openIssues?.length ?? 0;
  const criticalHighOpen = (openIssues ?? []).filter(
    (i) => i.severity === "critical" || i.severity === "high"
  ).length;

  const { data: planRows } = await supabase
    .from("weekly_report_daily_plans")
    .select("plan_date, planned_count")
    .eq("project_id", projectId)
    .in("plan_date", weekDates);

  const plannedByDate: Record<string, number> = {};
  for (const p of planRows ?? []) {
    plannedByDate[p.plan_date] = p.planned_count;
  }

  return aggregateWeeklyMetrics({
    testCases,
    runCases,
    openDefects,
    criticalHighOpen,
    weekDates,
    plannedByDate,
  });
}
```

(Same array-unwrap idiom for `test_case_features` already used twice elsewhere in this codebase — see the comment in `runs/[runId]/page.tsx`.)

- [x] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/weekly-report-metrics.ts`
Expected: no output.

- [x] **Step 3: Manual verification that this file has no `"use server"` surface-area problem**

Run: `npm run build`
Expected: build succeeds. This file is imported by both a Server Component (Task 8) and a `"use server"` actions file (Task 6) in later tasks — if this step fails only once those imports exist, come back and re-run it after Task 6, but it should already succeed now since this file itself has no directive at all.

- [x] **Step 4: Commit**

```bash
git add src/lib/weekly-report-metrics.ts
git commit -m "Add computeWeeklyReportMetrics query wrapper"
```

---

### Task 5: Server Actions — drafts and daily plans

**Files:**
- Create: `src/lib/actions/weekly-reports.ts`

- [x] **Step 1: Write the actions**

Create `src/lib/actions/weekly-reports.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import type { ActionState } from "@/lib/actions/auth";
import type { ReportRagStatus } from "@/lib/types/database";

export async function updateWeeklyReportDraft(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("update_weekly_report_draft", 60, 3600);
  if (limitError) return { error: limitError };

  const ragStatusRaw = formData.get("ragStatus");
  const highlights = formData.get("highlights");
  if (ragStatusRaw !== "red" && ragStatusRaw !== "amber" && ragStatusRaw !== "green") {
    return { error: "Choose a valid RAG status." };
  }
  // ragStatusRaw is `FormDataEntryValue | null` (string | File | null), which
  // TypeScript can't narrow via the negative `!==` checks above (that only
  // works for a variable already typed as a union of literals, not a plain
  // `string`). Re-check positively so `ragStatus` is genuinely narrowed to
  // ReportRagStatus below, instead of casting.
  const ragStatus: ReportRagStatus =
    ragStatusRaw === "red" ? "red" : ragStatusRaw === "amber" ? "amber" : "green";

  const supabase = await createClient();
  const { error } = await supabase.from("weekly_report_drafts").upsert({
    project_id: projectId,
    rag_status: ragStatus,
    highlights: typeof highlights === "string" ? highlights : "",
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/reports`);
  return {};
}

export async function updateDailyPlan(
  projectId: string,
  planDate: string,
  plannedCount: number
): Promise<void> {
  const ctx = await getUserContext();
  if (!ctx) return;

  const limitError = await rateLimit("update_daily_plan", 120, 3600);
  if (limitError) return;

  const supabase = await createClient();
  await supabase.from("weekly_report_daily_plans").upsert({
    project_id: projectId,
    plan_date: planDate,
    planned_count: Number.isFinite(plannedCount) && plannedCount >= 0 ? Math.floor(plannedCount) : 0,
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  });

  revalidatePath(`/projects/${projectId}/reports`);
}
```

Check for the stray `</content>` line: `tail -3 src/lib/actions/weekly-reports.ts`.

`updateWeeklyReportDraft` follows the form-bound `ActionState` shape (matching `uploadAttachment`); `updateDailyPlan` follows the fire-and-forget shape (matching `deleteAttachment`), since a single field edit doesn't need `useActionState` wiring in the UI (Task 9 wires it directly).

- [x] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/weekly-reports.ts`
Expected: no output.

- [x] **Step 3: Commit**

```bash
git add src/lib/actions/weekly-reports.ts
git commit -m "Add updateWeeklyReportDraft and updateDailyPlan Server Actions"
```

---

### Task 6: Server Actions — snapshot capture and editing

**Files:**
- Modify: `src/lib/actions/weekly-reports.ts`

- [x] **Step 1: Add the snapshot actions**

Append to `src/lib/actions/weekly-reports.ts`:

```ts
import { computeWeeklyReportMetrics, getWeekdayRange } from "@/lib/weekly-report-metrics";

export async function captureWeeklyReportSnapshot(
  projectId: string,
  weekEnding: string
): Promise<ActionState> {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("capture_weekly_report_snapshot", 20, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { data: draft } = await supabase
    .from("weekly_report_drafts")
    .select("rag_status, highlights")
    .eq("project_id", projectId)
    .single();

  const weekDates = getWeekdayRange(new Date());
  const metrics = await computeWeeklyReportMetrics(supabase, projectId, weekDates);

  const { data: planRows } = await supabase
    .from("weekly_report_daily_plans")
    .select("plan_date, planned_count")
    .eq("project_id", projectId)
    .in("plan_date", weekDates);

  const dailyPlanned: Record<string, number> = {};
  for (const p of planRows ?? []) {
    dailyPlanned[p.plan_date] = p.planned_count;
  }

  const { error } = await supabase.from("weekly_report_snapshots").insert({
    project_id: projectId,
    week_ending: weekEnding,
    rag_status: draft?.rag_status ?? "green",
    highlights: draft?.highlights ?? "",
    metrics,
    daily_planned: dailyPlanned,
    created_by: ctx.userId,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/reports`);
  revalidatePath(`/projects/${projectId}/reports/history`);
  return {};
}

export async function updateSnapshotEditorialFields(
  projectId: string,
  snapshotId: string,
  ragStatus: ReportRagStatus,
  highlights: string
): Promise<ActionState> {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("update_snapshot_editorial", 60, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();
  const { error } = await supabase
    .from("weekly_report_snapshots")
    .update({ rag_status: ragStatus, highlights })
    .eq("id", snapshotId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/reports/history/${snapshotId}`);
  return {};
}
```

Move the new `import { computeWeeklyReportMetrics, getWeekdayRange } from "@/lib/weekly-report-metrics";` line up to the top of the file with the other imports rather than leaving it mid-file — check the final file layout after this edit.

`updateSnapshotEditorialFields` only ever sets `rag_status`/`highlights` in its update payload, which is what actually enforces the "frozen numbers, editable editorial fields" rule described in the spec — the RLS `update` policy itself permits updating any column, exactly like `uploadAttachment`'s ownership check is enforced at the Server Action layer rather than in SQL.

- [x] **Step 2: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/weekly-reports.ts`
Expected: no output.

Run: `npm run build`
Expected: build succeeds — this is the point where `weekly-report-metrics.ts` is imported from a `"use server"` file; confirms there's no directive conflict.

**Deviation found and fixed during execution**: `npx tsc --noEmit` initially failed with `Type 'WeeklyMetrics' is not assignable to type 'Json'` on the `metrics` field of the `weekly_report_snapshots` insert — `WeeklyMetrics` (a named interface) and `Record<string, number>` (`dailyPlanned`) aren't structurally assignable to the generated `Json` type without an explicit cast, since neither has an index signature. Fixed by importing `Json` from `@/lib/types/database` and casting both values (`metrics as unknown as Json`, `dailyPlanned as unknown as Json`) at the insert call site. This is a real bug the plan's shown code had — it had never actually been run through `tsc` before this task executed.

- [x] **Step 3: Commit**

```bash
git add src/lib/actions/weekly-reports.ts
git commit -m "Add captureWeeklyReportSnapshot and updateSnapshotEditorialFields"
```

---

### Task 7: Add the Reports tab to project navigation

**Files:**
- Modify: `src/components/layout/project-tabs.tsx:6-11`

- [x] **Step 1: Add the tab**

In `src/components/layout/project-tabs.tsx`, replace the `TABS` array (currently lines 6-11):

```ts
const TABS = [
  { segment: "test-cases", label: "Test Cases" },
  { segment: "suites", label: "Suites" },
  { segment: "runs", label: "Runs" },
  { segment: "issues", label: "Issues" },
];
```

with:

```ts
const TABS = [
  { segment: "test-cases", label: "Test Cases" },
  { segment: "suites", label: "Suites" },
  { segment: "runs", label: "Runs" },
  { segment: "issues", label: "Issues" },
  { segment: "reports", label: "Reports" },
];
```

- [x] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output (the route doesn't exist yet until Task 8, but this is a plain string array — nothing to break yet).

Run: `npx eslint src/components/layout/project-tabs.tsx`
Expected: no output.

- [x] **Step 3: Commit**

```bash
git add src/components/layout/project-tabs.tsx
git commit -m "Add Reports tab to project navigation"
```

---

### Task 8: Live dashboard page

**Files:**
- Create: `src/app/(app)/projects/[projectId]/reports/page.tsx`
- Create: `src/components/reports/rag-editor.tsx`

- [x] **Step 1: Write the RAG/highlights editor component**

Create `src/components/reports/rag-editor.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { updateWeeklyReportDraft } from "@/lib/actions/weekly-reports";
import type { ActionState } from "@/lib/actions/auth";
import type { ReportRagStatus } from "@/lib/types/database";

const RAG_OPTIONS: { value: ReportRagStatus; label: string; tone: "red" | "amber" | "green" }[] = [
  { value: "green", label: "On Track", tone: "green" },
  { value: "amber", label: "At Risk", tone: "amber" },
  { value: "red", label: "Off Track", tone: "red" },
];

export function RagEditor({
  projectId,
  ragStatus,
  highlights,
}: {
  projectId: string;
  ragStatus: ReportRagStatus;
  highlights: string;
}) {
  const action = updateWeeklyReportDraft.bind(null, projectId);
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-ui-label font-semibold uppercase tracking-wide text-ink-tertiary">
          Overall Status
        </div>
        <div className="flex gap-2">
          {RAG_OPTIONS.map((opt) => (
            <label key={opt.value} className="cursor-pointer">
              <input
                type="radio"
                name="ragStatus"
                value={opt.value}
                defaultChecked={ragStatus === opt.value}
                className="peer sr-only"
              />
              <span className="peer-checked:ring-2 peer-checked:ring-primary rounded-full">
                <Badge tone={opt.tone}>{opt.label}</Badge>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-ui-label font-semibold uppercase tracking-wide text-ink-tertiary">
          Key Highlights
        </div>
        <textarea
          name="highlights"
          defaultValue={highlights}
          rows={4}
          placeholder="Key highlights for this week…"
          className="block w-full rounded-xl border border-border-light bg-paper-muted/50 px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
        />
      </div>
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
      {state.error && <p className="text-xs text-fail">{state.error}</p>}
    </form>
  );
}
```

Check for the stray `</content>` line: `tail -3 src/components/reports/rag-editor.tsx`.

- [x] **Step 2: Write the live dashboard page**

Create `src/app/(app)/projects/[projectId]/reports/page.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RagEditor } from "@/components/reports/rag-editor";
import { computeWeeklyReportMetrics, getWeekdayRange } from "@/lib/weekly-report-metrics";
import { captureWeeklyReportSnapshot } from "@/lib/actions/weekly-reports";

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default async function WeeklyReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  const { data: draft } = await supabase
    .from("weekly_report_drafts")
    .select("rag_status, highlights")
    .eq("project_id", projectId)
    .single();

  const weekDates = getWeekdayRange(new Date());
  const metrics = await computeWeeklyReportMetrics(supabase, projectId, weekDates);
  const weekEnding = weekDates[weekDates.length - 1];

  async function captureAction() {
    "use server";
    await captureWeeklyReportSnapshot(projectId, weekEnding);
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Weekly Status Report"
        description={project?.name ?? ""}
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${projectId}/reports/history`}
              className="text-sm font-medium text-primary hover:text-primary"
            >
              View history
            </Link>
            <form action={captureAction}>
              <Button type="submit" variant="primary">
                Capture this week&rsquo;s report
              </Button>
            </form>
          </div>
        }
      />

      <Card className="p-5">
        <RagEditor
          projectId={projectId}
          ragStatus={draft?.rag_status ?? "green"}
          highlights={draft?.highlights ?? ""}
        />
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-secondary">Key Metrics</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-ink-tertiary">Total Test Cases</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.totalTestCases}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Executed</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.executed}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">% Complete</div>
            <div className="text-lg font-semibold text-ink-primary">
              {formatPercent(metrics.percentComplete)}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Pass Rate</div>
            <div className="text-lg font-semibold text-ink-primary">{formatPercent(metrics.passRate)}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Open Defects</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.openDefects}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Critical/High Open</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.criticalHighOpen}</div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-secondary">Module / Test Area Progress</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-ink-tertiary">
              <th className="pb-2">Module</th>
              <th className="pb-2">Total</th>
              <th className="pb-2">Executed</th>
              <th className="pb-2">Passed</th>
              <th className="pb-2">Failed</th>
              <th className="pb-2">Blocked</th>
              <th className="pb-2">% Complete</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {metrics.moduleBreakdown.map((m) => {
              const pct = m.total === 0 ? 0 : m.executed / m.total;
              const tone = pct >= 0.8 ? "green" : pct > 0 ? "amber" : "red";
              return (
                <tr key={m.feature}>
                  <td className="py-2">{m.feature}</td>
                  <td className="py-2">{m.total}</td>
                  <td className="py-2">{m.executed}</td>
                  <td className="py-2">{m.passed}</td>
                  <td className="py-2">{m.failed}</td>
                  <td className="py-2">{m.blocked}</td>
                  <td className="py-2">
                    <Badge tone={tone}>{formatPercent(pct)}</Badge>
                  </td>
                </tr>
              );
            })}
            {metrics.moduleBreakdown.length === 0 && (
              <tr>
                <td colSpan={7} className="py-2 text-ink-tertiary">
                  No test cases in this project yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

Check for the stray `</content>` line: `tail -3 "src/app/(app)/projects/[projectId]/reports/page.tsx"`.

- [x] **Step 3: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/reports/rag-editor.tsx "src/app/(app)/projects/[projectId]/reports/page.tsx"`
Expected: no output.

Run: `npm run build`
Expected: build succeeds.

**Deviation found and fixed during execution**: `npx tsc --noEmit` initially failed with `Type '() => Promise<ActionState>' is not assignable to type 'string | ((formData: FormData) => void | Promise<void>) | undefined'` on the `<form action={captureAction}>` line, where `captureAction` was originally `captureWeeklyReportSnapshot.bind(null, projectId, weekEnding)`. Unlike `deleteRun` elsewhere in this codebase (which returns no value and binds cleanly as a form action), `captureWeeklyReportSnapshot` returns `Promise<ActionState>`, which `<form action>`'s type doesn't accept. Fixed by replacing the `.bind()` call with an inline Server Action wrapper (`async function captureAction() { "use server"; await captureWeeklyReportSnapshot(...); }`, shown corrected above) that discards the return value — this is a real bug the plan's shown code had, not caught until this task actually ran through `tsc`.

- [x] **Step 4: Commit**

```bash
git add src/components/reports/rag-editor.tsx "src/app/(app)/projects/[projectId]/reports/page.tsx"
git commit -m "Add live weekly status report dashboard"
```

---

### Task 9: Daily execution table with editable planned counts

**Files:**
- Create: `src/components/reports/daily-execution-table.tsx`
- Modify: `src/app/(app)/projects/[projectId]/reports/page.tsx`

- [ ] **Step 1: Write the daily execution table component**

Create `src/components/reports/daily-execution-table.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { clsx } from "clsx";
import { updateDailyPlan } from "@/lib/actions/weekly-reports";
import type { DailyExecutionEntry } from "@/lib/weekly-report-metrics";

function weekdayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function DailyExecutionTable({
  projectId,
  days,
}: {
  projectId: string;
  days: DailyExecutionEntry[];
}) {
  const [planned, setPlanned] = useState<Record<string, number>>(
    Object.fromEntries(days.map((d) => [d.date, d.planned]))
  );
  const [, startTransition] = useTransition();

  function handlePlannedChange(date: string, value: number) {
    setPlanned((prev) => ({ ...prev, [date]: value }));
    startTransition(async () => {
      await updateDailyPlan(projectId, date, value);
    });
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-ink-tertiary">
          <th className="pb-2">Day</th>
          <th className="pb-2">Planned</th>
          <th className="pb-2">Actual</th>
          <th className="pb-2">Passed</th>
          <th className="pb-2">Failed</th>
          <th className="pb-2">Blocked</th>
          <th className="pb-2">Variance</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border-light">
        {days.map((d) => {
          const plannedValue = planned[d.date] ?? 0;
          const variance = d.actual - plannedValue;
          return (
            <tr key={d.date}>
              <td className="py-2">
                {weekdayLabel(d.date)} <span className="text-ink-tertiary">{d.date}</span>
              </td>
              <td className="py-2">
                <input
                  type="number"
                  min={0}
                  value={plannedValue}
                  onChange={(e) => handlePlannedChange(d.date, Number(e.target.value))}
                  className="w-16 rounded-md border border-border-light px-2 py-1 text-sm"
                />
              </td>
              <td className="py-2">{d.actual}</td>
              <td className="py-2">{d.passed}</td>
              <td className="py-2">{d.failed}</td>
              <td className="py-2">{d.blocked}</td>
              <td
                className={clsx(
                  "py-2 font-semibold",
                  variance > 0 ? "text-pass" : variance < 0 ? "text-fail" : "text-ink-tertiary"
                )}
              >
                {variance > 0 ? `+${variance}` : variance}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

Check for the stray `</content>` line: `tail -3 src/components/reports/daily-execution-table.tsx`.

- [ ] **Step 2: Wire it into the dashboard page**

In `src/app/(app)/projects/[projectId]/reports/page.tsx`, add the import:

```ts
import { DailyExecutionTable } from "@/components/reports/daily-execution-table";
```

Add a new `Card` between the "Key Metrics" card and the "Module / Test Area Progress" card:

```tsx
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-secondary">Daily Test Execution</h2>
        <DailyExecutionTable projectId={projectId} days={metrics.dailyExecution} />
      </Card>
```

- [ ] **Step 3: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/reports/daily-execution-table.tsx "src/app/(app)/projects/[projectId]/reports/page.tsx"`
Expected: no output.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/reports/daily-execution-table.tsx "src/app/(app)/projects/[projectId]/reports/page.tsx"
git commit -m "Add editable daily execution table with planned/variance"
```

---

### Task 10: Snapshot history list

**Files:**
- Create: `src/app/(app)/projects/[projectId]/reports/history/page.tsx`

- [ ] **Step 1: Write the history page**

Create `src/app/(app)/projects/[projectId]/reports/history/page.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, Badge } from "@/components/ui/card";
import type { ReportRagStatus } from "@/lib/types/database";

function ragTone(status: ReportRagStatus): "red" | "amber" | "green" {
  return status;
}

export default async function WeeklyReportHistoryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: snapshots } = await supabase
    .from("weekly_report_snapshots")
    .select("id, week_ending, rag_status, highlights, created_at")
    .eq("project_id", projectId)
    .order("week_ending", { ascending: false })
    .order("created_at", { ascending: false });

  const byWeek = new Map<string, typeof snapshots>();
  for (const s of snapshots ?? []) {
    const existing = byWeek.get(s.week_ending) ?? [];
    existing.push(s);
    byWeek.set(s.week_ending, existing);
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Report History" description="Every captured weekly report for this project." />
      <div className="space-y-6">
        {Array.from(byWeek.entries()).map(([weekEnding, weekSnapshots]) => (
          <div key={weekEnding}>
            <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Week ending {weekEnding}</h2>
            <Card className="divide-y divide-border-light">
              {weekSnapshots!.map((s, i) => (
                <Link
                  key={s.id}
                  href={`/projects/${projectId}/reports/history/${s.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-paper-muted"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={ragTone(s.rag_status)}>{s.rag_status}</Badge>
                    <span className="truncate text-ink-primary">
                      {s.highlights.slice(0, 80) || "No highlights"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-ink-tertiary">
                    {i === 0 && (
                      <span className="rounded-full bg-surface-container-highest px-2 py-0.5 font-ui-label font-bold uppercase">
                        Current
                      </span>
                    )}
                    {new Date(s.created_at).toLocaleString()}
                  </div>
                </Link>
              ))}
            </Card>
          </div>
        ))}
        {(snapshots ?? []).length === 0 && (
          <p className="text-sm text-ink-tertiary">No reports captured yet.</p>
        )}
      </div>
    </div>
  );
}
```

Check for the stray `</content>` line: `tail -3 "src/app/(app)/projects/[projectId]/reports/history/page.tsx"`.

The query orders by `week_ending desc, created_at desc`, so within each `weekEnding` group the first entry (`i === 0`) is always the most recently captured one for that week — that's what gets the "Current" badge, per the spec's "most recent snapshot per week shown as default" rule.

- [ ] **Step 2: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/(app)/projects/[projectId]/reports/history/page.tsx"`
Expected: no output.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/reports/history/page.tsx"
git commit -m "Add weekly report history list, grouped by week"
```

---

### Task 11: Single snapshot view

**Files:**
- Create: `src/app/(app)/projects/[projectId]/reports/history/[snapshotId]/page.tsx`
- Create: `src/components/reports/snapshot-rag-editor.tsx`

- [ ] **Step 1: Write the snapshot editorial-fields editor**

Create `src/components/reports/snapshot-rag-editor.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { updateSnapshotEditorialFields } from "@/lib/actions/weekly-reports";
import type { ActionState } from "@/lib/actions/auth";
import type { ReportRagStatus } from "@/lib/types/database";

const RAG_OPTIONS: { value: ReportRagStatus; label: string; tone: "red" | "amber" | "green" }[] = [
  { value: "green", label: "On Track", tone: "green" },
  { value: "amber", label: "At Risk", tone: "amber" },
  { value: "red", label: "Off Track", tone: "red" },
];

export function SnapshotRagEditor({
  projectId,
  snapshotId,
  ragStatus,
  highlights,
}: {
  projectId: string;
  snapshotId: string;
  ragStatus: ReportRagStatus;
  highlights: string;
}) {
  async function action(_prevState: ActionState, formData: FormData): Promise<ActionState> {
    const ragRaw = formData.get("ragStatus");
    const text = formData.get("highlights");
    if (ragRaw !== "red" && ragRaw !== "amber" && ragRaw !== "green") {
      return { error: "Choose a valid RAG status." };
    }
    // See the matching comment in updateWeeklyReportDraft (weekly-reports.ts)
    // for why this can't just use `ragRaw` directly after the checks above.
    const rag: ReportRagStatus = ragRaw === "red" ? "red" : ragRaw === "amber" ? "amber" : "green";
    return updateSnapshotEditorialFields(projectId, snapshotId, rag, typeof text === "string" ? text : "");
  }

  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex gap-2">
        {RAG_OPTIONS.map((opt) => (
          <label key={opt.value} className="cursor-pointer">
            <input
              type="radio"
              name="ragStatus"
              value={opt.value}
              defaultChecked={ragStatus === opt.value}
              className="peer sr-only"
            />
            <span className="peer-checked:ring-2 peer-checked:ring-primary rounded-full">
              <Badge tone={opt.tone}>{opt.label}</Badge>
            </span>
          </label>
        ))}
      </div>
      <textarea
        name="highlights"
        defaultValue={highlights}
        rows={4}
        className="block w-full rounded-xl border border-border-light bg-paper-muted/50 px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
      />
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Saving…" : "Save correction"}
      </Button>
      {state.error && <p className="text-xs text-fail">{state.error}</p>}
    </form>
  );
}
```

Check for the stray `</content>` line: `tail -3 src/components/reports/snapshot-rag-editor.tsx`.

- [ ] **Step 2: Write the snapshot view page**

Create `src/app/(app)/projects/[projectId]/reports/history/[snapshotId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, Badge } from "@/components/ui/card";
import { SnapshotRagEditor } from "@/components/reports/snapshot-rag-editor";
import type { WeeklyMetrics } from "@/lib/weekly-report-metrics";

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default async function WeeklyReportSnapshotPage({
  params,
}: {
  params: Promise<{ projectId: string; snapshotId: string }>;
}) {
  const { projectId, snapshotId } = await params;
  const supabase = await createClient();

  const { data: snapshot } = await supabase
    .from("weekly_report_snapshots")
    .select("id, week_ending, rag_status, highlights, metrics, created_at")
    .eq("id", snapshotId)
    .single();

  if (!snapshot) notFound();

  const metrics = snapshot.metrics as unknown as WeeklyMetrics;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={`Report — Week Ending ${snapshot.week_ending}`}
        description={`Captured ${new Date(snapshot.created_at).toLocaleString()}`}
      />

      <Card className="p-5">
        <SnapshotRagEditor
          projectId={projectId}
          snapshotId={snapshot.id}
          ragStatus={snapshot.rag_status}
          highlights={snapshot.highlights}
        />
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-secondary">Key Metrics</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-ink-tertiary">Total Test Cases</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.totalTestCases}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Executed</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.executed}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">% Complete</div>
            <div className="text-lg font-semibold text-ink-primary">
              {formatPercent(metrics.percentComplete)}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Pass Rate</div>
            <div className="text-lg font-semibold text-ink-primary">{formatPercent(metrics.passRate)}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Open Defects</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.openDefects}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Critical/High Open</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.criticalHighOpen}</div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-secondary">Daily Test Execution</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-ink-tertiary">
              <th className="pb-2">Date</th>
              <th className="pb-2">Planned</th>
              <th className="pb-2">Actual</th>
              <th className="pb-2">Passed</th>
              <th className="pb-2">Failed</th>
              <th className="pb-2">Blocked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {metrics.dailyExecution.map((d) => (
              <tr key={d.date}>
                <td className="py-2">{d.date}</td>
                <td className="py-2">{d.planned}</td>
                <td className="py-2">{d.actual}</td>
                <td className="py-2">{d.passed}</td>
                <td className="py-2">{d.failed}</td>
                <td className="py-2">{d.blocked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-secondary">Module / Test Area Progress</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-ink-tertiary">
              <th className="pb-2">Module</th>
              <th className="pb-2">Total</th>
              <th className="pb-2">Executed</th>
              <th className="pb-2">Passed</th>
              <th className="pb-2">Failed</th>
              <th className="pb-2">Blocked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {metrics.moduleBreakdown.map((m) => (
              <tr key={m.feature}>
                <td className="py-2">{m.feature}</td>
                <td className="py-2">{m.total}</td>
                <td className="py-2">{m.executed}</td>
                <td className="py-2">{m.passed}</td>
                <td className="py-2">{m.failed}</td>
                <td className="py-2">{m.blocked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

Check for the stray `</content>` line: `tail -3 "src/app/(app)/projects/[projectId]/reports/history/[snapshotId]/page.tsx"`.

Note the `Badge` import in this page is unused if you copy it verbatim without the RAG display elsewhere — double check with the eslint step below and remove it if flagged; it's only listed here because `SnapshotRagEditor` handles RAG display internally.

- [ ] **Step 3: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/reports/snapshot-rag-editor.tsx "src/app/(app)/projects/[projectId]/reports/history/[snapshotId]/page.tsx"`
Expected: no output. If an unused `Badge` import is flagged per the note above, remove it and re-run.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/reports/snapshot-rag-editor.tsx "src/app/(app)/projects/[projectId]/reports/history/[snapshotId]/page.tsx"
git commit -m "Add single snapshot view with editable editorial fields"
```

---

### Task 12: Full verification pass and docs

**Files:**
- Modify: `README.md`
- Modify: `docs/build-status.md`

- [ ] **Step 1: Full automated verification**

Run each of these and confirm the stated expectation:

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
npx eslint .
```
Expected: no new errors/warnings beyond any pre-existing accepted ones.

```bash
npm test
```
Expected: all unit tests pass, including every test in `src/lib/weekly-report-metrics.test.ts`.

```bash
npm run build
```
Expected: production build succeeds.

```bash
git status --short
```
Expected: clean (everything from Tasks 1-11 already committed).

- [ ] **Step 2: Manual browser walkthrough (write these instructions, do not attempt to execute them — this environment has no way to log into the live app)**

1. Open a project with some test cases and at least one executed run (`Projects → [a project] → Reports`).
2. Confirm the Key Metrics numbers look right — Total Test Cases should match that project's actual test case count, Executed should match how many have at least one run result.
3. Set an RAG status and type something into Key Highlights, click Save. Reload the page — confirm both persisted.
4. Enter a planned count for one of the weekdays in the Daily Test Execution table. Confirm the Variance column updates (green if actual > planned, red if actual < planned).
5. Click "Capture this week's report." Confirm it doesn't error, and the live dashboard's numbers/RAG/highlights are unchanged afterward (capturing doesn't reset the live view).
6. Click "View history." Confirm the just-captured snapshot appears under today's `week_ending` date, tagged "Current."
7. Click "Capture this week's report" again without changing anything. Confirm a *second* snapshot now appears under the same week — both visible in history, the newer one tagged "Current," the older one still present underneath.
8. Open the older (non-current) snapshot from history. Confirm its numbers match what was true at that capture time.
9. On that older snapshot's page, change the RAG status and save. Confirm it saves without creating a new snapshot row (history list still shows the same two snapshots for that week, not three).
10. As a sanity check for frozen numbers: close an issue in that project (via Issues), then revisit the older snapshot. Confirm its `Open Defects` count is unchanged, even though the live dashboard's count now reflects the closed issue.

- [ ] **Step 3: Update README.md**

Read the current `README.md` in full first (don't assume its structure hasn't shifted since the last edit). Find the section listing shipped features and add a bullet:

```markdown
- Weekly Status Report per project — live dashboard (RAG status, key metrics, daily execution with planned/variance, module breakdown) plus a non-destructive snapshot history for sharing a stable point-in-time record with stakeholders.
```

- [ ] **Step 4: Update docs/build-status.md**

Read the current `docs/build-status.md` in full first. Add this feature to the "Shipped and working" list, and update the "Reports" area's description if it currently says something like "coming soon" or references only the placeholder page — this is real, working content now, not a placeholder, even though the top-level cross-project `/reports` page is untouched and still shows its own "coming soon" cards for the *other*, not-yet-built report types.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/build-status.md
git commit -m "Document weekly status report in README and build status"
```
