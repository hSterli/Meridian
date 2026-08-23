# Test Bottleneck Identification — Design

**Date**: 2026-08-21
**Status**: Approved, pending implementation
**Context**: Roadmap item 6 of 6, the last of the four "TestRail differentiators." Had zero prior definition anywhere in the project — no PRD, no prior brainstorming, not even a descriptive line like Real-Time Visibility Dashboard had. Scoped entirely from scratch via brainstorming, narrowing from several candidate interpretations (long-stuck blocked tests, slow-to-complete runs, slow-to-resolve issues, overloaded assignees) down to one.

## Problem

`test_run_cases.status` already models `blocked` as a real, deliberate state a tester sets during execution — but nothing in Meridian surfaces which blocked items are actually stuck. A blocked run-case is exactly as visible as a passed or failed one: buried in whichever run it belongs to, with no cross-project view of what's currently stalling testing progress.

## Scope decisions

1. **Target: long-stuck blocked run-cases, specifically.** Of the four candidate interpretations explored during brainstorming (blocked items, slow-completing runs, slow-resolving issues, overloaded assignees), this is the one chosen — it's the only one built on a status value the schema already models explicitly (`run_case_status` includes `blocked` as a first-class value), rather than requiring a new definition of "slow" derived from timestamps that weren't captured for this purpose.
2. **Scoped to open runs only (`planned`/`in_progress`), not completed ones.** A blocked item in a `completed` run is historical record, not something anyone is likely to act on — including it would dilute a list meant to answer "what's stuck right now."
3. **No minimum "blocked for N days" threshold.** Every currently-blocked run-case in an open run appears, sorted by how long it's been blocked (longest first) — no arbitrary cutoff to pick, tune, or later regret. Matches how every other list in this app works (sorted, not threshold-filtered) — the flaky-test score needed a minimum-executions threshold to filter out noise from a test run once or twice, but a `blocked` status is already a deliberate signal someone set; there's no equivalent noise to filter here.
4. **Placement: another section on the existing cross-project `/reports` page**, directly below the "Flaky tests" section shipped earlier this session — same page, same pattern, cross-project. There's no existing stub card for this on `/reports` (unlike flaky tests, which had one) — this is a new section, not a stub being built out.
5. **No new schema, no new table, no new column.** Everything needed already exists: `test_run_cases.status`, `.executed_at` (set whenever a result is recorded, including `blocked` — this is what "blocked since" is derived from), `.notes`; `test_runs.status`/`.name`; `test_cases.title`.
6. **Reuses the `/reports` page's existing `test_run_cases` fetch** rather than adding a second query. That fetch already selects rows across all the org's projects, already excludes `pending`, and already includes everything the flaky-tests section needs — it just needs three more columns added to the select list (`notes`, and `test_runs.name`/`.status`) to also serve this section, avoiding a second round-trip for overlapping data.

## Architecture

New file `src/lib/blocked-tests.ts`, pure function, same convention as `computeFlakyTests`/`aggregateWeeklyMetrics` — no I/O, unit-tested with fixed input → fixed output:

```ts
// src/lib/blocked-tests.ts
export interface RawBlockedRunCaseRow {
  testCaseId: string;
  title: string;
  projectId: string;
  runId: string;
  runName: string;
  runStatus: "planned" | "in_progress" | "completed";
  status: "pending" | "passed" | "failed" | "blocked" | "skipped";
  executedAt: string | null;
  notes: string | null;
}

export interface BlockedTestEntry {
  testCaseId: string;
  title: string;
  projectId: string;
  runId: string;
  runName: string;
  blockedSince: string; // ISO timestamp, from executedAt
  notes: string | null;
}

export function computeBlockedTests(rows: RawBlockedRunCaseRow[]): BlockedTestEntry[];
```

Behavior:
- Filter to rows where `status === "blocked"`, `runStatus` is `"planned"` or `"in_progress"`, and `executedAt` is non-null (a `blocked` result always has a timestamp — `executed_at` is set whenever any result is recorded, `blocked` included — so this is a defensive filter, not an expected real-world exclusion).
- Sort by `executedAt` ascending — oldest first, i.e. longest-blocked first.
- Map to `BlockedTestEntry`, renaming `executedAt` to `blockedSince` for clarity at the call site (this value represents "since when has this been sitting blocked," not "when was it last executed" in the general sense the raw field name implies elsewhere in the codebase).

`src/app/(app)/reports/page.tsx` gains:
- Two more columns in the existing `test_run_cases` select: `notes`, and `name`/`status` on the already-joined `test_runs!inner(...)`.
- A second row-mapping pass (alongside the existing flaky-rows mapping) building `RawBlockedRunCaseRow[]` from the same fetched rows, then `computeBlockedTests(blockedRows)`.
- A new "Blocked tests" section, same `Card`/list styling as "Flaky tests", below it. Each entry links to the **run** (`/projects/[projectId]/runs/[runId]`), not the test case — the blocked status belongs to this specific run-case, and the run page is where someone would actually re-execute it or see full context. Shows: title, run name, project name, "blocked since" formatted via `date-fns`'s `formatDistanceToNow` (already a project dependency, unused elsewhere in the codebase — no new package needed), and the `notes` field if present (often where a tester explained *why* it's blocked).
- Empty state: "No blocked tests right now — nice work" (or similar), shown when the list is empty.

## Testing

`src/lib/blocked-tests.test.ts`, mirroring `flaky-tests.test.ts`'s style: fixed rows in, exact filtered/sorted output out. Cases to cover: a `blocked` row in a `completed` run is excluded; a `blocked` row in a `planned` or `in_progress` run is included; non-`blocked` statuses (`passed`/`failed`/`skipped`/`pending`) are excluded regardless of run status; sort order is oldest-`executedAt`-first across multiple blocked rows; `notes: null` passes through as `null`, not coerced to an empty string.

## Explicitly out of scope

- Slow-to-complete runs, slow-to-resolve issues, and overloaded-assignee views (scope decision 1) — all considered during the brainstorm, all rejected in favor of the narrower, schema-native target.
- A minimum-days-blocked threshold or any other configurable filter (scope decision 3).
- Completed runs' blocked history (scope decision 2).
- Any action on a blocked entry from this view (dismiss, reassign, bulk re-execute) — this is a read-only surface, same as the flaky-tests section; acting on a blocked item happens through the existing Test Runner, by navigating to the run this list already links to.
