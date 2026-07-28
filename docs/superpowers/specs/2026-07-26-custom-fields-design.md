# Custom Fields on Test Cases — Design

**Date**: 2026-07-26
**Status**: Approved, pending implementation plan
**Context**: First of seven sequenced V1/Phase-1 (P0) gaps identified by cross-referencing the original source PRD (`~/Downloads/prd-meridian-qa.md`, §7.2: "Create/organize test cases via tags + custom fields + dynamic filters"). Chosen first because it's the one item on that list with no dependency on anything else (no external integrations, no new auth layer).

## Problem

`test_cases.custom_fields` is a jsonb column that has existed since the very first migration (`0001_init.sql`) but has never been read or written by any page or Server Action. The PRD treats custom fields as core P0 test case management, on par with tags and dynamic filters — not a stretch feature. Today there is no way for a project to define one, set one, or filter by one.

## Decisions

1. **Field types**: text, number, single-select dropdown. Covers the large majority of real custom-field use cases (e.g. "Component", "Story points", "Test environment") without building a full form-builder. Explicitly not building checkbox or date types in this pass.
2. **Scope: per-project**, not org-wide. Matches the existing `test_case_features` pattern exactly — each project manages its own list, so a mobile-QA project and an API-testing project can define different fields without one admin's edits affecting every other project in the org.
3. **CSV**: dynamic columns per project, full round-trip (export and import), not export-only and not skipped entirely.
4. **List view**: every field renders as a badge per row (matching Feature/Sprint's existing style). Only `select`-type fields get a dedicated filter dropdown (like Feature/Priority/Status) — `text`/`number` fields don't have a finite value set to filter by, so they display but aren't filterable via a dropdown in this pass.

## Schema

New table `test_case_custom_fields`, mirroring `test_case_features`'s structure and RLS treatment:

```sql
create type test_case_custom_field_type as enum ('text', 'number', 'select');

create table test_case_custom_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  field_type test_case_custom_field_type not null,
  options jsonb not null default '[]', -- string[], only meaningful when field_type = 'select'
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create index test_case_custom_fields_project_id_idx on test_case_custom_fields(project_id);

alter table test_case_custom_fields enable row level security;

create policy "members can view custom fields" on test_case_custom_fields
  for select using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can manage custom fields" on test_case_custom_fields
  for all using (private.is_org_member(private.project_org_id(project_id)))
  with check (private.is_org_member(private.project_org_id(project_id)));
```

**Values live in the existing `test_cases.custom_fields` jsonb column**, keyed by **field id**, not field name: `{"<field-uuid>": "Checkout"}`. Keying by id means renaming a field later doesn't orphan existing data — only the CSV and UI layers need to resolve id↔name, at the boundary, not the stored data itself.

**`field_type` is immutable after creation.** Editing a field's `name` or `options` (for `select` fields) is fine; changing its type is not supported in this pass — it would require deciding what happens to already-stored values of the old type (e.g. a `text` field with free-form values becoming a `select` field), which isn't worth solving for a first version. If a field's type needs to change, the workaround is delete-and-recreate.

**Deleting a field definition** leaves existing test cases with a stale, orphaned key in their `custom_fields` jsonb — harmless, since only currently-defined fields are ever rendered or read. No cleanup/migration of existing rows on delete.

**Editing a `select` field's options to remove a value that's in use** does not retroactively touch existing test cases. Their stored value simply becomes unselectable going forward (it won't appear in the dropdown for new edits) but isn't deleted or blanked out.

## Where fields get defined

Unlike Feature (an inline "+ Add new" sentinel in the test case form) or Tags (free-text, auto-created on save), a custom field needs a type and, for `select`, an options list — too much structure for an inline sentinel widget. This gets a small dedicated management page: `/projects/[projectId]/test-cases/custom-fields`, linked from the Test Cases screen, listing existing fields with add/edit/delete actions. New Server Actions in a new `src/lib/actions/custom-fields.ts`, following the existing rate-limited Server Action pattern (see `src/lib/actions/test-cases.ts` for the shape to match).

## Test case form & list view

- **Form** (`test-case-form.tsx`): after the existing fields, render one input per defined field for the current project — `Input` (text), `Input type="number"` or the existing `NumberStepper` (number), or the shared `Select` component (single-select) — pre-filled from `custom_fields[fieldId]` when editing an existing test case. Field name becomes the form field's `name` attribute as `customField_<fieldId>` so `createTestCase`/`updateTestCase` can parse them generically without one code path per field.
- **List view** (`test-cases/page.tsx`): every field's value renders as a badge per row, positioned alongside the existing Feature/Sprint/Tag badges.
- **Filters** (`test-case-filters.tsx`): gains one `Select`-based dropdown filter per `select`-type custom field, following the exact pattern the existing Feature/Priority/Status filters already use. `text`/`number` fields are not filterable in this pass.

## Validation

- `number` fields: reject non-numeric input with the same `{error: "..."}` inline pattern used everywhere else in this app (see `createTestCase`'s `if (!title) return { error: ... }` style).
- `select` fields: reject any submitted value that isn't currently in that field's `options` list.
- Both validations happen in the Server Action (`createTestCase`/`updateTestCase`), not just client-side, consistent with how every other field in this app is validated.

## CSV round-trip

**Export**: one column appended per defined field, in `display_order`, after the existing fixed columns (`title,preconditions,priority,status,tags,feature,sprint,steps,<field 1 name>,<field 2 name>,...`).

**Import — a required behavior change, not just an addition**: `bulkImportTestCases` today discards the header row entirely (`const [, ...dataLines] = lines; // skip header`) and destructures columns by fixed position. That assumption breaks the moment column count varies by project. Import will start actually reading the header row and mapping columns by name instead of position. This incidentally makes the existing fixed columns more robust to reordering too, which is a welcome side effect, not a goal in itself — don't expand scope here beyond what's needed to support dynamic custom-field columns.

## Explicitly out of scope for this pass

- Checkbox and date field types.
- Org-wide (cross-project) custom fields.
- Changing a field's type after creation.
- A "manage visible columns" control for when a project defines many fields (list-view clutter) — worth revisiting if it becomes a real problem, not speculatively now.
- Filtering by `text`/`number` custom fields.

## Open items for the implementation plan

- Exact request-parsing helper shape for `customField_<fieldId>` form fields — likely a small shared function in `test-cases.ts` that takes the project's field definitions and a `FormData`, and returns a validated `Record<fieldId, value>` or an error, called from both `createTestCase` and `updateTestCase`.
- Whether the custom-fields management page needs its own confirmation step before deleting a field definition that's currently in use by test cases (the review that produced this project's punch-list flagged inconsistent delete-confirmation behavior app-wide as a separate, not-yet-addressed issue — worth deciding whether this new page follows the current "no confirmation" convention or breaks it, during planning rather than here).
