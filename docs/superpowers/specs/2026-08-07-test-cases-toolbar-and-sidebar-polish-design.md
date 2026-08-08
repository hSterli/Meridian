# Test Cases Toolbar Polish + Collapsible Sidebar — Design

**Date**: 2026-08-07
**Status**: Approved, pending implementation
**Context**: Direct follow-up feedback on the just-shipped collapsible filter toolbar (`docs/superpowers/specs/2026-08-07-collapsible-test-case-filters-design.md`), bundled with one new, separate feature (collapsible sidebar) and one default-behavior change (Test Cases default grouping).

## Scope decisions

1. **Filter icon**: swap the plain "Filters" text button to use `SlidersHorizontal` (lucide-react) next to the label, matching the reference icon exactly.
2. **Same-line filter row**: `flex-wrap` → `flex-nowrap overflow-x-auto` on the expanded filter row, so it never breaks to a second line — it scrolls horizontally within its own row on narrow windows instead.
3. **Test Cases default grouping**: default to grouping by feature when no explicit choice has been made, while still letting a user explicitly pick "No grouping" and have that stick. This needs a real fix, not just a default value change — see below.
4. **Collapsible sidebar**: `Sidebar` (`src/components/layout/sidebar.tsx`) gains a collapsed icon-only rail state, persisted in `localStorage`. It's the only place `Sidebar` renders (confirmed via `(app)/layout.tsx`; two other components share the word "Sidebar" in their name — `RunFolderSidebar`, `TestCaseSuiteSidebar` — but are unrelated, page-specific components, not touched here). The parent layout's `flex-1` main content area reflows automatically since it's already plain flexbox; no other file needs to change for this.
5. **Responsiveness**: scoped to the Test Cases page only (matches the horizontal-scroll filter row plus a general check for other overflow-prone elements on that page) — not a full app-wide audit.

## The grouping-default problem

The groupBy `<Select>` currently has three options: `""` (No grouping), `"feature"`, `"sprint"`, and the shared `updateParam` helper deletes a URL param whenever the selected value is falsy (`""`). That means "the user explicitly chose No grouping" and "the user never touched this control" are currently indistinguishable — both result in an absent `groupBy` param. If the default were naively changed to "group by feature when the param is absent," a user who explicitly picks "No grouping" would find it silently revert to feature-grouping on their next page load.

**Fix**: give "No grouping" its own explicit, truthy param value (`"none"`) instead of `""`, so it's never deleted by `updateParam`. The effective grouping becomes:

- No `groupBy` param at all → default to `"feature"`.
- `groupBy=none` → no grouping (explicit user choice, persists).
- `groupBy=feature` / `groupBy=sprint` → as today.

This needs two coordinated changes: the `<Select>`'s option value and default value in `TestCaseFilters`, and a single computed `effectiveGroupBy` variable in the Test Cases page (`src/app/(app)/projects/[projectId]/test-cases/page.tsx`) used everywhere the raw `groupBy` searchParam is currently read (the grouping logic and the two "hide this badge since it's redundant with the current grouping" checks in the row renderer).

## Sidebar collapsed-state design

Width `w-60` (expanded) ↔ `w-16` (collapsed), toggled by a `PanelLeftClose`/`PanelLeftOpen` button. In the collapsed state:

- **Nav items** (Dashboard/Projects/Reports/Settings/Team): icon-only, labels hidden, `title` attribute added for a native hover tooltip (no dedicated tooltip component exists yet in this codebase, so this is the pragmatic accessible fallback rather than building one).
- **"New Project"**: icon-only button (just the `Plus` icon).
- **Help Center / Log Out**: icon-only, same `title`-attribute treatment.
- **Org switcher, role badge, "Meridian QA" title, user email**: hidden entirely when collapsed. These involve either a dropdown of full org names or arbitrary-length text that don't have a clean icon-only representation — the user expands the sidebar to reach them rather than this feature trying to preserve every piece of functionality in a 16px-wide rail.

State persists via `localStorage` (read in a `useEffect` after mount, to avoid an SSR/hydration mismatch — the component renders expanded on first paint, then immediately applies the stored preference).

## Testing

Manual only — every change here is presentational (icon swap, layout, a client-side collapse toggle, a grouping default). No new business logic warrants an automated test.
