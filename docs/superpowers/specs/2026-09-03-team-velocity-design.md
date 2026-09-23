# Team Velocity Report — Design

**Date**: 2026-09-03
**Status**: Approved, pending implementation
**Context**: Third and final stub card on the cross-project `/reports` page (Pass/fail trend and the Flaky/Blocked tests sections were both built earlier this session). Current stub description: "Test cases authored and runs executed per team member, per sprint." Coverage by requirement, the third originally-planned card, stays deferred — it needs a Requirements entity that doesn't exist in this schema.

## Problem

There's no view anywhere in the app showing who on the team is doing what. Test case authorship (`test_cases.created_by`) and run execution (`test_run_cases.executed_by`) are both tracked at the row level, but neither is ever aggregated per person. Managers have no way to see, at a glance, who's authoring test cases versus who's executing runs, or how that breaks down by sprint for teams that use sprints.

## Scope decisions

1. **Two separate counts per person — authored and executed — not one combined "velocity" score.** Authoring and executing are different kinds of work; collapsing them into one weighted number would hide which one someone actually did and require picking an arbitrary weighting between two unlike activities.
2. **Executed results are grouped by sprint via the underlying test case's `sprint_number`, not by execution date.** A `test_run_cases` row has no sprint of its own. Falling back to the test case's `sprint_number` (with a "No sprint" bucket for nulls) reuses the exact source of truth the Test Case Library already groups by, rather than inventing a second, inconsistent notion of "sprint" based on calendar time — this app has no Sprint entity with real start/end dates to bucket against.
3. **CI-ingested results (`executed_by is null`) are excluded from the executed count entirely.** This is a human-productivity metric — a CI run completing isn't a person's work. Rows with a null executor are simply skipped, not attributed to a synthetic "CI" row.
4. **A sprint filter, independent of and in addition to the page's existing project filter.** The project filter (`?project=`) already exists on `/reports` and already scopes every section on the page (Pass/Fail Trend, Flaky tests, Blocked tests) — Team Velocity inherits it for free, no new component. A *new* `?sprint=` filter serves agile teams who want to see one sprint's breakdown specifically; project scoping alone serves waterfall-style teams who may not use `sprint_number` at all. Both filters compose (a selected project narrows which sprint numbers even show up as options).
5. **Sprint filter defaults to "All sprints," not the most recent sprint number.** "All sprints" aggregates everyone's totals across all sprints (and any "No sprint" cases) — functionally identical to no filter being applied. Defaulting to the *highest* `sprint_number` instead would leave a waterfall team (whose cases are all `sprint_number = null`) looking at an empty "No sprint" view by default, needing an extra click just to see their own data. Options are: "All sprints", each distinct `sprint_number` value actually present (scoped by the current project filter), and "No sprint" — the last option only shown if at least one in-scope test case has a null `sprint_number`.
6. **Rows with zero authored and zero executed are omitted**, matching how Flaky tests and Blocked tests only ever show rows that qualify rather than a full member roster padded with inactive people.
7. **Sort order: executed count descending, then authored count descending, then name ascending** as a final, stable tiebreaker for people tied on both counts.
8. **Display format is a table (name / authored / executed), not a chart.** Two precise numbers per person read more accurately as table columns than as bars, and it's a smaller build than a two-series grouped bar chart — no new geometry function needed the way `buildAreaChartPath` was for Pass/Fail Trend.
9. **`get_org_members` gains a `full_name` column**, pulled from `auth.users`' metadata via `u.raw_user_meta_data->>'full_name'` (the exact same expression `org-context.ts`'s `getUserContext()` reads for the signed-in user, and the same field `updateProfile` writes to), so the table shows a real name and falls back to email only when unset — matching how the sidebar already displays the signed-in user. Adding a column to this RPC's return table is additive and doesn't break its other existing callers (issue assignment, run ownership displays, etc.), which already destructure only `user_id`/`email`/`role`/`created_at` by name.

## Architecture

New file `src/lib/team-velocity.ts`, pure function, same convention as `computeFlakyTests`/`computeBlockedTests`/`computePassRateTrend`:

```ts
// src/lib/team-velocity.ts
export interface RawAuthoredRow {
  createdBy: string; // user id
}

export interface RawExecutedRow {
  executedBy: string; // user id — callers must already filter out nulls before passing rows in
}

export interface VelocityRow {
  userId: string;
  authored: number;
  executed: number;
}

export function computeTeamVelocity(
  authoredRows: RawAuthoredRow[],
  executedRows: RawExecutedRow[]
): VelocityRow[];
```

Behavior:
- Tallies `authoredRows` by `createdBy` and `executedRows` by `executedBy` into two count maps, merges the union of both maps' keys into `VelocityRow[]`.
- Drops any resulting row where both `authored` and `executed` are `0` (this can only happen if a caller passes a row with an unexpected/empty id, since every input row by construction contributes at least one count to its own user — this guard exists for defensiveness, not because it's expected to trigger in practice).
- Sorted by `executed` descending, then `authored` descending, then `userId` ascending. (Sorting by `userId` rather than name keeps this function name-agnostic — the page resolves `userId` to a display name/email afterward, same separation `flaky-tests.ts` and `blocked-tests.ts` already keep between "compute" and "render.")

Both `sprint_number` filtering (scope decision 2) and the "exclude null executor" rule (scope decision 3) happen **before** calling `computeTeamVelocity` — the function itself is sprint- and executor-null-agnostic; it just tallies whatever rows it's handed. This mirrors `computePassRateTrend`'s split between "the page decides what's in scope via its queries" and "the pure function just aggregates."

`src/app/(app)/reports/page.tsx` gains:
- A `sprint` search param (`?sprint=`), alongside the existing `project` one. Resolution logic: fetch the distinct `sprint_number` values present across `test_cases` scoped to the current `projectIds` (one lightweight query, `select("sprint_number").in("project_id", projectIds)`, de-duplicated and sorted numerically in JS — this table is small enough per org that a dedicated SQL `distinct` isn't needed), determine whether any are `null` (for the "No sprint" option), and validate the incoming `sprint` param against that computed set exactly the way `selectedProjectId` is validated against `allProjectIds` today (invalid or missing value falls back to "All sprints").
- Two new queries, both additionally filtered by the resolved sprint selection (an `.eq("sprint_number", n)` / `.is("sprint_number", null)` / no filter at all for "All sprints"):
  - Authored: `test_cases` scoped by `projectIds`, `select("created_by, sprint_number")`, with the sprint filter applied directly (`.eq("sprint_number", n)` / `.is("sprint_number", null)` / no filter for "All sprints") since `sprint_number` lives on this table directly.
  - Executed: `test_run_cases` joined to **both** `test_runs!inner(project_id)` (for project scoping, existing pattern on this page) **and** `test_cases!inner(sprint_number)` (for sprint scoping — the `!inner` is required here, not the default left join, because PostgREST only lets a query filter on an embedded resource's columns when that embed is `!inner`), `select("executed_by, test_cases!inner(sprint_number)")`, `.not("executed_by", "is", null)`, with the sprint filter applied via the joined table's dot-path (`.eq("test_cases.sprint_number", n)` / `.is("test_cases.sprint_number", null)` / no filter for "All sprints").
- A call to `get_org_members` (via `supabase.rpc`, same call shape already used on the Test Case Library page) to resolve `userId` → `{ full_name, email }` for display, built into a `Map`.
- A new "Team velocity" section, replacing that `PLANNED_REPORTS` stub entry, rendering the sorted `VelocityRow[]` as a table with a name column (full name, falling back to email) and two numeric columns (Authored, Executed). The sprint filter renders as a `<select>` next to the existing project filter in the page's header action slot, following the same pattern as `DashboardProjectFilter` (a small client component reading/writing `?sprint=` via `useSearchParams`/`router.push`) — this new component is `SprintFilter`, not a reuse of `DashboardProjectFilter`, since the two filters have different option sources (org projects vs. computed sprint numbers) and are visually two separate dropdowns.

## Testing

`src/lib/team-velocity.test.ts`, mirroring the established style (fixed rows in, exact array out). Cases to cover: a person who only authored (executed stays 0); a person who only executed; a person who did both; two people tied on executed count sorted by authored count; two people tied on both counts sorted by userId; a row that would net to zero-zero is absent from the output.

## Explicitly out of scope

- Any chart/visual representation — this is a table (scope decision 8).
- A synthetic "CI" row for null-executor results (scope decision 3).
- Editing sprint numbers or any other write path from this report — read-only, same as Pass/Fail Trend and Flaky/Blocked tests.
- A real Sprint entity with dates/boundaries — `sprint_number` remains a bare integer on `test_cases`, unchanged by this feature.
