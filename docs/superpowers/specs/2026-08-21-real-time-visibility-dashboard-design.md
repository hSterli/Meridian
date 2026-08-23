# Real-Time Visibility Dashboard — Design

**Date**: 2026-08-21
**Status**: Approved, pending implementation
**Context**: Roadmap item 5 of 6 (one of the four "TestRail differentiators"). Unlike Flaky Test Detection or the GitHub/Slack integrations, this item had no prior definition anywhere in the project — a single doc line ("the existing analytics dashboard covers some of this; no dedicated design pass done") was the entire starting point. Scoped from scratch via brainstorming.

## Problem

Every view in Meridian — the cross-project dashboard, the per-project Weekly Status Report, the `/reports` page — is a standard Next.js Server Component: data is only as fresh as the last full page load or navigation. For a report meant to be left open on a shared screen during a testing sprint or release day, that means it silently goes stale until someone happens to reload it.

## Scope decisions

1. **This extends the existing per-project Weekly Status Report — it is not a new page or new data model.** The brainstorm initially explored several much broader framings (a live shared cross-project dashboard, watching a single run execute live, per-executor activity awareness, a configurable multi-project view) and narrowed hard, in order, to: periodic auto-refresh (not push-based real-time) of the report that already shows exactly the data asked for — overall pass/fail rate, issues per module, a daily execution table, and a weekly snapshot mechanism. All of that already exists in `src/app/(app)/projects/[projectId]/reports/page.tsx` via `aggregateWeeklyMetrics`; nothing about the underlying metrics changes.
2. **"Real-time" means a 10-minute client-side auto-refresh, not push-based updates.** No websockets, no Supabase Realtime subscription (confirmed unused anywhere in this codebase), no new backend infrastructure. A client timer periodically calls Next.js's `router.refresh()`, which re-runs the page's Server Component and re-renders with whatever the normal data fetch returns — the same mechanism a manual reload already triggers, just automatic.
3. **No cross-project scope, no project switcher.** An earlier line of questioning considered letting a viewer pick which project(s) feed the view, but once the target was confirmed to be the existing single-project report (already scoped by its URL), that need evaporated — a project switcher would be solving a problem that no longer exists in this design.
4. **No per-executor breakdown.** Explicitly ruled out by the user — the aggregate pass/fail rate, module-level issue counts, and daily execution counts are what matters, not who ran what.
5. **No new schema, no new Server Action.** The page's existing data fetch (`computeWeeklyReportMetrics`) already returns current data on every render; auto-refresh only needed a reason to re-trigger that render on a timer. Nothing about how the data is stored or written changes.
6. **Verified safe against the two editable widgets on this page before committing to the approach.** `RagEditor` uses uncontrolled inputs (`defaultValue`/`defaultChecked` — set once on mount, not resynced from props on re-render) and `DailyExecutionTable` initializes its local `planned` state from props only via `useState`'s one-time initializer. Neither resets from fresh props on a `router.refresh()`-triggered re-render, so a viewer's in-progress edit (typed-but-unsaved highlights, a planned-count edit mid-flight) survives a background refresh. This was confirmed by reading both components' actual implementations, not assumed.

## Architecture

New client component `src/components/reports/auto-refresh.tsx`:

```tsx
"use client";

interface AutoRefreshProps {
  intervalMs?: number; // default 10 minutes
}
```

- `useEffect` + `setInterval(intervalMs)` calling `useRouter().refresh()` on each tick.
- Skips the `router.refresh()` call (but keeps the interval running so the last-refreshed label stays accurate) when `document.visibilityState !== "visible"`, checked at tick time — no `visibilitychange` listener needed for the skip itself, since the check only needs to happen at the moment a tick fires.
- Renders a small "Last refreshed: Xm ago" label, driven by its own 1-minute UI tick (`setInterval` #2, purely client-side display state) measuring elapsed time since the component's own record of the last successful `router.refresh()` call — independent of the refresh timer itself, so the label stays accurate even between refresh ticks.
- Mounted once near the top of `WeeklyReportPage`'s returned JSX, alongside the existing RAG/highlights editor and daily execution table — doesn't wrap or alter any existing markup.

No changes to `computeWeeklyReportMetrics`, `aggregateWeeklyMetrics`, the `weekly_report_drafts`/`weekly_report_daily_plans` tables, or any Server Action.

## Testing

`AutoRefresh` is a thin client-side timer wrapper around `useRouter().refresh()` and `document.visibilityState` — both are runtime/browser APIs, not pure logic, so this isn't meaningfully unit-testable the way `computeFlakyTests`/`aggregateWeeklyMetrics` are (this codebase has no existing pattern for testing client-side timer effects, and inventing one for a single small component isn't justified). Verified instead by manual browser check: confirm the report page re-fetches on the timer, confirm an in-progress edit in either widget survives a refresh, confirm the tab-hidden case skips a tick, confirm the last-refreshed label counts up correctly.

## Explicitly out of scope

- Push-based/websocket real-time updates (scope decision 2) — no infrastructure for this exists anywhere in the codebase; a 10-minute poll is the entire "real-time" story for this pass.
- A live cross-project shared-screen dashboard, a single-run live execution view, and per-executor activity awareness — all considered during the brainstorm and rejected in favor of the much narrower confirmed scope.
- Cross-project aggregation or a project switcher (scope decision 3).
- Per-executor result breakdown (scope decision 4).
- A configurable refresh interval — hardcoded at 10 minutes, no settings surface introduced for this.
