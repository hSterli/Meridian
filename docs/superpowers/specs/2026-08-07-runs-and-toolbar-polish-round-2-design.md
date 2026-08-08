# Runs & Toolbar Polish, Round 2 — Design

**Date**: 2026-08-07
**Status**: Approved, pending implementation
**Context**: Direct follow-up feedback after two prior polish rounds this session (collapsible filter toggle, then filter icon/sidebar collapse). Bundles five small, related fixes. Two items from the original feedback batch are explicitly excluded here: a PDF-export feature for "Capture this week's report" (bigger scope, was already deferred when Weekly Report was designed — gets its own separate design pass) and a broader mobile-responsive layout pass (flagged but not requested yet).

## Scope decisions

1. **ENTER badge contrast** — `run-executor.tsx`'s shared `.kbd` class has no explicit text color, so it inherits whatever the parent button sets. On the three light-background status buttons that's fine (dark text on a light `paper-muted` badge background); on the dark-green Pass Case button, the badge inherits `text-white`, producing white text on a light badge background — unreadable. Fix locally on that one button rather than changing the shared `.kbd` class (which works correctly everywhere else).
2. **Runs list hover tooltip** — reuse the segmented bar's existing `row.segments` data (`passed`/`failed`/`blocked`/`skipped`/`pending`, already computed and rendered as colored segments) via a native `title` attribute, rather than building a custom tooltip component. No dialog/tooltip primitive exists anywhere in this codebase yet, and a native title tooltip is consistent with the pattern already used for the collapsed sidebar's icon-only nav labels.
3. **CSV toolbar cleanup**: remove the Quick Actions sidebar's duplicate "Export as CSV" link (the header's "Export CSV" button stays, matching the PRD-style precedent of "one clear place per action"). Move Import CSV into that same header action row. Import CSV's file input moves behind a click-to-open modal instead of being permanently visible on the page.
4. **New Modal component** — this is the first modal/dialog in the codebase (confirmed: nothing in `src/components/ui/` or elsewhere). Build a minimal, reusable one (`src/components/ui/modal.tsx`) rather than a one-off inline implementation specific to CSV import, since it's a generically useful primitive other features will likely want later. Scope: overlay + centered card, click-outside-to-close, Escape-to-close, `role="dialog" aria-modal="true"` — no focus trap, no animation library, no portal (renders in place; a `fixed inset-0` overlay doesn't need a portal to visually cover the page).
5. **Filter label hides when open** — the "Filters" toggle button drops its text label once the panel is expanded (icon + count badge only), since the visible filter controls already make the button's purpose self-evident at that point.
6. **Tags as a single-select dropdown** — tag filtering is already single-value under the hood (`searchParams.get("tag")` is a single string, not a list), so converting the row of pill buttons into one `<Select>` matching the existing feature/priority/status dropdowns' exact pattern is a direct swap with no URL-schema or filtering-logic change.

## Implementation

**`src/components/runs/run-executor.tsx`**: the Pass Case button's `<span className="kbd ...">` gets an explicit dark text color class added (e.g. `text-ink-primary`) so it renders correctly regardless of the parent's inherited color, matching how the badge already looks on the other three buttons.

**`src/components/runs/runs-table.tsx`**: the segmented-bar container `<div>` gets a `title` attribute built from `row.segments`, e.g. `` `Passed: ${row.segments.passed} · Failed: ${row.segments.failed} · Blocked: ${row.segments.blocked} · Skipped: ${row.segments.skipped} · Not run: ${row.segments.pending}` ``.

**`src/components/ui/modal.tsx`** (new): `Modal({ open, onClose, title, children })` — renders `null` when `!open`; otherwise a `fixed inset-0` semi-transparent overlay (click closes), a centered `Card`-styled panel (click doesn't propagate/close), an `Escape` keydown listener (via `useEffect`) that calls `onClose`, and a header row with `title` + a close button.

**`src/components/test-cases/import-csv-form.tsx`**: instead of always rendering the file input inline, renders an "Import CSV" trigger button that opens local `useState<boolean>` modal state; the existing form/file-input/submit logic moves inside `<Modal>`.

**`src/app/(app)/projects/[projectId]/test-cases/page.tsx`**: `ImportCsvForm` moves into the header's action row (next to the existing "Export CSV" and "New test case" buttons); the Quick Actions sidebar Card's "Export as CSV" link is deleted.

**`src/components/test-cases/test-case-filters.tsx`**: the toggle button's `Filters` text is wrapped in `{!filtersOpen && "Filters"}`; the tag-pills block is replaced with a `<Select>` using the identical pattern as the existing feature/priority/status dropdowns (`defaultValue={searchParams.get("tag") ?? ""}`, `onChange={(e) => updateParam("tag", e.target.value)}`, `<option value="">All tags</option>` + one `<option>` per tag).

## Explicitly out of scope

- PDF export for captured weekly reports (separate design pass, next).
- Broader mobile-responsive layout pass for the Test Cases page's two-column layout (flagged in the prior round, not yet requested as a concrete task).
- Multi-select tag filtering (today's single-select capability is preserved as-is, just re-skinned as a dropdown).

## Testing

Manual only — every change here is presentational/UI (a CSS fix, a native tooltip, a new but simple modal component, and dropdown/layout rearrangement). No new business logic warrants an automated test.
