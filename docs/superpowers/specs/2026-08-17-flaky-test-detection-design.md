# Flaky Test Detection — Design

**Date**: 2026-08-17
**Status**: Approved, pending implementation
**Context**: Resumes a brainstorm paused mid-clarifying-questions before this session's checklist work (CI ingestion, GitHub integration) took over. A large external PRD (`Flaky_Test_Detective_PRD_with_Azure.md`, never committed to this repo) had proposed an entire separate CI-observability SaaS business — GitHub Actions/CircleCI/Jenkins/Azure Pipelines webhook ingestion, its own AWS infra, Slack/email digest systems, Azure AD SSO, on-prem Docker, SOC2/HIPAA, its own $14M ARR pricing plan. Almost none of that matches Meridian as it exists. This design deliberately scopes down to what's actually buildable on top of Meridian's existing data model.

## Problem

Meridian already has a crude flaky-test signal: the cross-project dashboard flags any test case with at least one pass and one fail anywhere in its history, shows the top 5 by fail count. There's no real score (a test that failed once in 200 runs ranks the same as one that fails every other run), no way to see more than 5, and no per-test detail — just a name and two badge counts. The top-level `/reports` page already has a "Flaky-test deep dive" card describing exactly this gap (*"Full history for any test with mixed pass/fail results, not just the top 5"*) — it's been a stub since that page was built.

## Scope decisions

1. **Compute from existing data only — no schema changes.** Since this brainstorm was originally paused, CI-triggered run ingestion (`POST /api/v1/runs/ingest`) has shipped, so CI-reported results already land in `test_run_cases` alongside manually-executed ones. The original "should we build CI webhook ingestion for richer signal" framing is now moot — that data already flows in. There's no `branch`/`commit` column (run identity is a free-text `name`), so root-cause is limited to "this test flips between pass and fail," not "this only fails on branch X." That richer signal is explicitly deferred (see below), not built here.
2. **No paid-feature gating in V1.** Consistent with billing/plan tiers being explicitly deferred everywhere else in this codebase (no Stripe, no `org.plan` column, nothing to gate against). Ships free; monetization is a separate future project once real billing exists.
3. **Placement: build out the existing cross-project `/reports` stub, not a new per-project tab.** The "Flaky-test deep dive" card on `src/app/(app)/reports/page.tsx` becomes a real, full, unlimited list — matching the app's own existing IA rather than inventing a new per-project Reports sub-tab. The dashboard's existing top-5 widget (`src/app/(app)/dashboard/page.tsx`) is upgraded to use the same score and gets a "See all →" link into `/reports`.
4. **Score = `min(passed, failed) / total`, over a bounded per-test window of the last 10 executions — not all history, not time-decayed.** A test needs ≥3 executions within that window to qualify at all (filters out noise from a test run once or twice). All-history scoring was rejected because a test that was flaky early on but has since stabilized would never actually clear — its score just dilutes asymptotically toward zero as more clean runs accumulate, never reaching it, and could still outrank an actively-flaky test for a long time on infrequently-run tests. A bounded window fixes this cleanly: once a test's last 10 executions are all clean, its score is exactly `0` and it drops off the list. Full recency-weighted decay (weighting recent flips more than old ones, continuous rather than a hard window) was considered and rejected as unnecessary complexity — a hard window gets the same practical outcome (resolved tests actually clear) without a half-life function to design and tune.
5. **Read-only report — no dismiss/acknowledge.** No new writable state, no new table/column beyond what scoring needs (which is none). A team that wants to act on a flagged test does so through the existing Test Cases flow (edit, deprecate, etc.), same as today.
6. **Score computed in JS as a pure function, not a SQL aggregation.** Matches `aggregateWeeklyMetrics` (`src/lib/weekly-report-metrics.ts`) exactly: one function, unit-testable with fixed input → fixed output, used identically by every consumer. The existing v0 dashboard tracker already aggregates this way at the same (cross-project) scale, so this isn't a new load pattern for the app. A SQL function would be more scalable at very high execution volume, but breaks from this project's established report-metrics convention and can't be exercised by Vitest.

## Data model

No migration. `computeFlakyTests` consumes the same shape of rows the dashboard already fetches — a join of `test_run_cases` (`test_case_id`, `status`, `executed_at`) to `test_cases.title` — scoped by `.in("test_runs.project_id", projectIds)` exactly as the existing dashboard query already does (all projects in the active org, or a single project if `?project=` is set).

```ts
// src/lib/flaky-tests.ts
export interface RawFlakyRunCaseRow {
  testCaseId: string;
  title: string;
  status: "pending" | "passed" | "failed" | "blocked" | "skipped";
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
  windowSize?: number; // default 10
  minExecutions?: number; // default 3
  limit?: number; // default: no limit
}

export function computeFlakyTests(
  rows: RawFlakyRunCaseRow[],
  options?: ComputeFlakyTestsOptions
): FlakyTestEntry[];
```

Behavior:
- Group rows by `testCaseId`. Within each group, **first discard any row whose `status` isn't `passed` or `failed`** (`blocked`/`skipped`/`pending` say nothing about pass/fail flakiness and never occupy a window slot), then sort the remainder by `executedAt` descending and take the first `windowSize` (default 10) — i.e. the window is "the last 10 pass/fail executions," not "the last 10 executions, some of which might not count."
- Count `passed`/`failed` within that windowed slice; `total` is just its length.
- Skip any test case whose windowed `total` is below `minExecutions` (default 3).
- `score = min(passed, failed) / total`.
- Sort the result by `score` descending, tie-break by `total` descending.
- Apply `limit` last, if given.

## Consumers

**`src/app/(app)/reports/page.tsx`** — the existing `PLANNED_REPORTS` stub array loses its "Flaky-test deep dive" entry; that card is replaced with a real section below the remaining three (still-stubbed) cards. Fetches the same `test_run_cases` join the dashboard uses, scoped to all of the active org's projects, calls `computeFlakyTests(rows)` with no `limit`, renders a list: title (linking to the test case), pass/fail counts, score as a rounded percentage, project name (since this view is cross-project). Empty state reuses the dashboard's existing copy ("No flaky tests detected yet — a test needs at least 3 recent executions with a mix of pass and fail to show here," adjusted for the window wording).

**`src/app/(app)/dashboard/page.tsx`** — the inline `byTestCase`/`flaky` computation (lines ~93–106 today) is deleted and replaced with a call to `computeFlakyTests(rows, { limit: 5 })`, using the same `runCases` fetch already in place (no query changes). The widget's copy and layout stay the same; a "See all →" link is added pointing to `/reports`.

## Testing

`src/lib/flaky-tests.test.ts`, mirroring `weekly-report-metrics.test.ts`'s style: fixed rows in, exact scored/sorted/filtered output out. Cases to cover: a test below the minimum-executions threshold is excluded; a test with exactly 10 clean executions in a row scores `0`; a test with an 11th execution (older, outside the window) that was a failure does *not* affect the score once it's pushed out of the window; `blocked`/`skipped`/`pending` results are excluded from both the window-fill and the total; tie-breaking by execution count when two tests have equal scores; `limit` truncates after sorting, not before.

## Explicitly out of scope

- Branch/commit-level root cause (scope decision 1) — would need a schema addition to `POST /api/v1/runs/ingest`/`test_runs`, deferred as a separate future project if CI-originated metadata becomes available.
- Any paid-feature gating (scope decision 2).
- Dismiss/acknowledge or any other writable interaction with a flagged test (scope decision 5).
- Full recency-weighted/time-decayed scoring (scope decision 4) — the bounded window covers the "resolved tests should clear" case without it.
- Scheduled digest delivery of the flaky-test list (e.g. a weekly Slack/email summary) — no scheduling infrastructure exists anywhere in this codebase yet (confirmed via repo-wide search during this session's earlier work); a separate future project.
- Configurable window size / minimum-executions threshold (currently hardcoded defaults, `windowSize: 10`, `minExecutions: 3`) — no settings surface for this exists and none is being added for V1.
