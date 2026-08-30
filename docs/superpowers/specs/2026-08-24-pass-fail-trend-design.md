# Pass/Fail Trend — Design

**Date**: 2026-08-24
**Status**: Approved, pending implementation
**Context**: First of three remaining stub cards on the cross-project `/reports` page (Pass/fail trend, Coverage by requirement, Team velocity). Coverage by requirement is explicitly out of scope for now — it depends on a Requirements entity that doesn't exist anywhere in this schema and was separately deferred earlier in this project's own checklist. Team velocity is a separate future brainstorm. This is also the first genuinely new report *shape* built this session — Flaky tests and Blocked tests (built earlier on this same page) are both "list of currently-problematic items"; this is a time-series, and the first real chart anywhere in this codebase.

## Problem

The `/reports` page's "Pass/fail trend" card has been a stub since the page was built, described as "Cross-project pass rate over time, drillable by project or date range." Nothing in the app shows pass rate as a trend today — the dashboard's "Recent runs — pass/fail trend" widget is per-*run* (each run's own pass rate, last 10 runs), not per-*day* over time, and the Weekly Status Report's `passRate` is single-project, week-scoped, and based on the latest status per test case rather than a daily event count.

## Scope decisions

1. **Daily buckets, fixed 30-day lookback.** Not weekly, not a user-selectable range. Fine-grained enough to spot a single bad day without being noisy, and avoids building a date-range picker component (this codebase has none anywhere) for a first pass.
2. **"Drillable by project" means a project filter, mirroring the dashboard's existing pattern exactly** — a `?project=` query param and dropdown (the same `DashboardProjectFilter` component/mechanism, not a new UI concept). Default (no project selected) aggregates pass rate across all of the org's projects; selecting one scopes the whole trend to just that project.
3. **Renders as an actual chart, not a table.** This is what "trend" implies, and every other report in this app is text/badges/tables — this is a deliberate first step into real charting, not a workaround.
4. **Hand-rolled SVG, no charting library.** Matches this codebase's established pattern of avoiding new dependencies for things a modest amount of custom code can do — the dashboard's own pass-rate bars are already hand-rolled divs, and a past decision explicitly chose hand-rolled drag-and-drop over a library dependency for the same reason. 30 daily data points is well within what a basic SVG polygon/polyline needs, and it matches the Paper/Ink design system's exact colors rather than reconciling a library's default look.
5. **Filled area chart** (confirmed via visual mockup comparison against a plain line and a bar chart) — a line with a soft gradient fill underneath, reading as a continuous trend with a bit more visual weight than a bare line.
6. **Pass rate = `passed / (passed + failed)` per day, excluding blocked/skipped from both sides.** This differs from two existing-but-not-directly-applicable precedents: the dashboard's per-run `passed / all-results` (which dilutes the rate whenever a run has blocked/skipped cases) and the Weekly Report's `passed / executed` (built around "latest status per test case," which doesn't map onto a per-day event count). A day that's mostly blocked tests shouldn't read as a bad day for this metric.
7. **A day with zero `passed`+`failed` results is omitted from the output entirely — not plotted as 0%.** A gap in the chart correctly reads as "no data that day"; a 0% data point would incorrectly read as "everything failed."
8. **Needs its own date-bounded query, not a reuse of the page's existing Flaky/Blocked-tests fetch.** That existing `test_run_cases` query on `/reports` pulls unbounded history (Flaky/Blocked tests each do their own filtering/windowing after the fact). A 30-day trend only ever needs the last 30 days server-side — pulling everything just to discard most of it is wasteful for a query that's already shared across three sections on one page load.

## Architecture

New file `src/lib/pass-rate-trend.ts`, pure function, same convention as `computeFlakyTests`/`computeBlockedTests`:

```ts
// src/lib/pass-rate-trend.ts
export interface RawTrendRunCaseRow {
  status: "pending" | "passed" | "failed" | "blocked" | "skipped";
  executedAt: string | null;
}

export interface DailyPassRate {
  date: string; // YYYY-MM-DD
  passed: number;
  failed: number;
  passRate: number; // 0..1
}

export function computePassRateTrend(rows: RawTrendRunCaseRow[], days?: number): DailyPassRate[];
```

Behavior:
- Filter to rows where `status` is `passed` or `failed` and `executedAt` is non-null (`blocked`/`skipped`/`pending` excluded per scope decision 6).
- Group by the UTC calendar date portion of `executedAt` (`YYYY-MM-DD`, matching the existing `weekday-label`/date-bucketing convention already used in `weekly-report-metrics.ts` and `daily-execution-table.tsx`).
- For each date with at least one `passed`+`failed` row: `passRate = passed / (passed + failed)`.
- Dates with zero qualifying rows are omitted (scope decision 7) — the function only ever returns entries for days that actually had a pass/fail verdict, not a zero-filled 30-slot array.
- Sorted ascending by date (oldest first, matching left-to-right chart reading order).
- `days` parameter (default 30) exists for testability (fixed "today" in tests) rather than as a product-facing option — scope decision 1 fixes this at 30 in the UI, matching how `computeFlakyTests`' `windowSize` is also a testability/default knob, not a user-facing setting.

`src/app/(app)/reports/page.tsx` gains:
- A new date-bounded query: `test_run_cases` filtered by `.gte("executed_at", thirtyDaysAgoIso)`, scoped by the same project-filter logic the dashboard already uses (`projectIds` narrowed to a single project if `?project=` is set, else all of the org's projects) — separate from the existing unbounded Flaky/Blocked-tests query.
- A new "Pass/fail trend" section, replacing that stub card, rendering the SVG chart: x-axis is date (day of month or short labels, sparse enough not to overlap at 30 points), y-axis is implicit (0-100% via the fill's vertical extent, no numeric axis labels needed for a trend read), using the exact `#1e8a5b` (pass) green from the visual mockup for the line/fill.
- The project filter itself is added to `/reports`' `PageHeader` action slot, reusing `DashboardProjectFilter` (`src/components/dashboard/project-filter.tsx`) directly — confirmed it's fully page-agnostic (builds its URL from `usePathname()`, takes `projects` as a prop, no `/dashboard`-specific coupling anywhere), so no extraction or duplication is needed.

## Testing

`src/lib/pass-rate-trend.test.ts`, mirroring `flaky-tests.test.ts`/`blocked-tests.test.ts`'s style: fixed rows in, exact bucketed/computed output out. Cases to cover: a day with only `passed` rows scores `1.0`; a day with only `failed` rows scores `0`; blocked/skipped rows on an otherwise-empty day don't produce a `0%` entry (the day is omitted, not zeroed); multiple rows on the same UTC date are correctly grouped into one entry; a row outside the `days` window is excluded; output is sorted ascending by date.

The SVG rendering itself (path/polygon coordinate math from a list of `DailyPassRate` entries to pixel positions) is a reasonable candidate for its own small pure function too (e.g. `buildAreaChartPath(entries, width, height)`), kept separate from `computePassRateTrend` so the data computation and the pixel-geometry math can be tested independently — the implementation plan should decide the exact split.

## Explicitly out of scope

- Weekly/user-selectable granularity or date range (scope decision 1).
- Any interaction beyond the existing project filter — no click-to-drill-into-a-day, no tooltips, no hover state (a future enhancement, not this pass).
- A charting library (scope decision 4).
- Coverage by requirement and Team velocity — the other two `/reports` stub cards, each its own separate future project.
