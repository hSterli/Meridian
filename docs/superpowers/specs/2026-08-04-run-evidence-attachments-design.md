# Run Evidence Attachments (Screenshots from the Runs Screen) — Design

**Date**: 2026-08-04
**Status**: Approved, pending implementation plan
**Context**: Not one of the seven sequenced V1/P0 PRD gaps — a standalone UX enhancement request made mid-session, while the automated-test-suite project was mid-execution (that project resumes after this one ships). Builds on the existing test-case attachments mechanism (Storage bucket + RLS, shipped in an earlier phase this session) and the `issues` table's existing `linked_run_case_id` precedent for "evidence tied to a specific run execution."

## Problem

Testers executing a run (`src/components/runs/run-executor.tsx`) can record a status (Pass/Fail/Blocked/Skip) and free-text notes for each test case, but have no way to attach visual evidence — a screenshot of a failure — without leaving the run screen, opening the test case in a separate tab, and uploading it there disconnected from which run/execution produced it.

## Scope decisions

1. **Screenshots only, not video screen recording.** Video (`MediaRecorder`/`getDisplayMedia`) is a materially larger lift — browser permission prompts, much larger file sizes, no existing precedent anywhere in this codebase — and was explicitly deferred to a possible future project during brainstorming. This resolves an open question from earlier in the session about whether to build screen recording at all.
2. **Evidence is tagged to the run execution, but surfaces on the test case's existing Attachments panel** — not a separate run-only view, and not a plain untagged test-case attachment. This mirrors the precedent already in this codebase: the `issues` table has both `linked_test_case_id` and `linked_run_case_id`. Concretely: extend the existing `test_case_attachments` table with a nullable `run_case_id` rather than building a second table/bucket/panel.
3. **Upload via file picker AND clipboard paste, multiple screenshots per run-case.** Paste support matters because the common QA workflow is "take a screenshot, then paste it in" — a file-picker-only flow is a materially worse experience for that workflow. Multiple attachments per run-case matches how the existing per-test-case attachments already allow multiple files.
4. **UI placement: side-by-side with the notes textarea** (chosen visually, over "always-visible strip between notes and status buttons" and "collapsible toggle below status buttons"). Paste lands naturally near where the tester is already looking/typing.

## Data model

One additive column on the existing table — no new table, no new bucket, no RLS changes:

```sql
alter table test_case_attachments
  add column run_case_id uuid references test_run_cases(id) on delete set null;

create index idx_test_case_attachments_run_case_id on test_case_attachments(run_case_id);
```

`on delete set null`: deleting a run un-tags its screenshots but never deletes them — the evidence stays permanently on the test case, consistent with attachments being fundamentally test-case-scoped.

No RLS policy changes: existing `test_case_attachments` policies are keyed off `test_case_id` → `private.project_org_id(...)` → org membership, exactly as today. `run_case_id` is additive metadata, not a new access boundary.

**Storage**: unchanged. Same `test-case-attachments` bucket, same path convention (`${projectId}/${testCaseId}/${uuid}-${sanitizedFilename}`), same 10MB max size, same `upload_attachment` rate limit (30/3600s) — paste-triggered uploads count against the same limit as file-picker uploads, deliberately, to avoid a paste-driven rate-limit bypass.

## Server Actions

Extend `uploadAttachment(projectId, testCaseId, prevState, formData)` in `src/lib/actions/attachments.ts` — do not add a second near-duplicate action:

- Read an optional `runCaseId` from `formData`.
- When present, verify the referenced `test_run_cases` row's `test_case_id` actually equals the `testCaseId` param before inserting (defense-in-depth against a spoofed/mismatched pairing — never trust client-supplied cross-entity linkage, even from trusted UI code).
- Insert the `test_case_attachments` row with `run_case_id` set (or left null for uploads from the test case detail page, unchanged from today).

`deleteAttachment` and `getAttachmentDownloadUrl` need no changes — deletion/download permission is purely org-membership based and doesn't depend on `run_case_id`.

## UI components

**New**: `src/components/runs/run-case-screenshots.tsx` (`RunCaseScreenshots`) — renders the thumbnail strip + "+" upload tile in the layout column next to the notes textarea. Props: `projectId`, `runCaseId`, `testCaseId`, and the run-case's current attachments (loaded server-side, not fetched client-side).

**Modified**: `src/app/(app)/projects/[projectId]/runs/[runId]/page.tsx` — extend the existing server-side query to nest each run-case's `test_case_attachments` (filtered by `run_case_id`) alongside the already-nested `test_case` select, so screenshots load with the page.

**Modified**: `src/components/runs/run-executor.tsx` — render `RunCaseScreenshots` in the new column, and add paste handling (below).

**Modified**: `src/components/test-cases/attachments-panel.tsx` (and its data source, the test case detail page query) — show a small "from Run: {run name}" tag under the filename when `run_case_id` is set, requiring a join `test_run_cases → test_runs.name`. Attachments without `run_case_id` render exactly as they do today, no tag.

### Paste handling

`RunExecutor` displays exactly one `current` run-case at a time (confirmed by reading the component — there's a sidebar list to jump between cases, but only one is rendered as the active card), so a paste event is never ambiguous about which run-case it targets.

A `window.addEventListener("paste", ...)` scoped to the component's mounted lifetime (mirroring the existing keyboard-shortcut listener at `run-executor.tsx:99-112`) inspects `event.clipboardData.items`:

- **Image type found** → `event.preventDefault()`, extract via `item.getAsFile()`, build a `FormData`, call `uploadAttachment` (via `startTransition`, the same direct-call pattern already used for `setRunCaseStatus` — Server Actions are just async functions, no `<form>` submission required), show an optimistic loading thumbnail, replace with the real thumbnail (or an inline error) once it resolves.
- **No image (plain text paste)** → do nothing; default paste behavior proceeds untouched, so pasting text into the notes field is unaffected.

The file-picker "+" tile is a standard hidden `<input type="file" accept="image/*" multiple>` that calls the same upload path per selected file. Clicking a thumbnail reuses the existing `getAttachmentDownloadUrl` signed-URL flow. A hover "×" on a thumbnail calls the existing `deleteAttachment`.

## Error handling

- Oversized file, rate limit exceeded, or network failure during upload → a small inline error appears in the thumbnail strip itself (e.g. "Screenshot too large (max 10MB)" / "Upload failed, try again"). This never blocks or interrupts marking a Pass/Fail/Blocked/Skip status — attaching evidence and recording a result are independent actions.
- A non-image clipboard paste is simply not intercepted — verified as an explicit test case, not just an assumption.

## Testing

Fits directly into the automated-test-suite infrastructure already mid-build this session:

- **Unit**: if a pure `clipboardItemsToImageFile(items: DataTransferItemList): File | null` helper gets extracted from the paste handler (recommended, keeps the DOM-event-mocking surface small), it gets a unit test in the same style as the existing CSV/step-parsing helper tests.
- **Integration**: extend the RLS-as-a-real-user pattern to verify a user cannot attach a screenshot with a spoofed `runCaseId` belonging to a different org's run — the ownership check in `uploadAttachment` should reject it.
- **e2e**: not included in the currently-planned golden-path e2e spec (login → create test case → see it in list); left for a future addition, not a blocker for this feature.

## Explicitly out of scope

- Video screen recording (`MediaRecorder`/`getDisplayMedia`) — deferred to a possible future project.
- Image annotation/markup (drawing arrows/boxes on a screenshot before attaching) — not requested, YAGNI.
- An aggregate "all evidence across this run" view spanning multiple run-cases — the `run_case_id` index supports this if built later, but no UI consumes it that way in this pass.
