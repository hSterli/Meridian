# Collapsible Test Case Filters — Design

**Date**: 2026-08-07
**Status**: Approved, pending implementation
**Context**: Small UX fix requested directly from a screenshot of the Test Cases list page — the filter toolbar (search, features/priorities/statuses/custom-field dropdowns, a grouping select, and tag pills) is crowded and visible in full at all times.

## Problem

`TestCaseFilters` (`src/components/test-cases/test-case-filters.tsx`) renders every filter control simultaneously in one `flex flex-wrap` row. On a project with several custom fields and tags, this row grows long and visually noisy even when no filters are active.

## Scope decisions

1. **Search stays always visible; everything else collapses** behind a "Filters" toggle button. Search is the most-used control and shouldn't require an extra click.
2. **The toggle shows an active-filter count badge** (e.g. "Filters · 2"), computed from non-empty `feature`/`priority`/`status`/`tag`/`cf_*` URL params. `groupBy` is excluded from the count since it's presentation, not filtering.
3. **Default open/closed state depends on whether filters are already active** in the URL on page load (e.g. a bookmarked or shared filtered link) — open if so, collapsed otherwise. This avoids silently hiding an active filter.
4. **`ImportCsvForm` is out of scope** — it's a sibling component (an action, not a filter) and stays exactly where and how it renders today.
5. **Test Cases page only.** Runs/Issues list toolbars are untouched; this pattern can be reused there later if they turn out to have the same crowding problem.

## Implementation

Purely a client-side change to `TestCaseFilters`:

- Add `const [filtersOpen, setFiltersOpen] = useState(initiallyOpen)`, where `initiallyOpen` is computed once from whether `searchParams` has any of `feature`/`priority`/`status`/`tag`/or a `cf_` prefixed key set.
- A toggle button (chevron icon + label + count badge, mirroring the existing local-boolean-state + chevron pattern already used for the org switcher in `src/components/layout/sidebar.tsx`, since no dedicated disclosure component exists yet in this codebase) sits next to the Search input.
- The existing block of controls (features/priorities/statuses/custom fields/grouping-select/tag pills) gets wrapped in `{filtersOpen && (...)}` — no changes to the controls themselves, their URL-param wiring, or their behavior.

No new files, no server-side changes, no new dependencies.

## Testing

Manual only — this is a pure client-side visibility toggle with no new data flow. No automated test is warranted (nothing here is business logic; it's presentational state).
