# Run Evidence Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Note for this repo**: neither named sub-skill is installed here — execute via a fresh general-purpose subagent per task, with the orchestrator reviewing each task's actual diff before dispatching the next (same approach used for every prior plan this session).

**Goal:** Let testers attach screenshots to a test case directly from the Runs screen — via file picker or clipboard paste — with each screenshot tagged to the specific run execution that produced it, while still showing up on the test case's own Attachments panel.

**Architecture:** One additive nullable `run_case_id` column on the existing `test_case_attachments` table (no new table, no new Storage bucket, no RLS changes — mirrors the `issues` table's existing `linked_test_case_id`/`linked_run_case_id` dual-FK precedent). The existing `uploadAttachment` Server Action is extended to accept an optional `runCaseId`. A new `RunCaseScreenshots` component renders a thumbnail strip next to the notes textarea in `run-executor.tsx`; a window-level paste listener (mirroring the existing keyboard-shortcut listener) intercepts image clipboard pastes since `RunExecutor` only ever shows one `current` run-case at a time, so a paste is never ambiguous about its target.

**Tech Stack:** Next.js 16 Server Actions, Supabase (Postgres/Storage/RLS), TypeScript, Tailwind v4, Vitest (for the one pure helper this plan extracts).

**Known repo quirk to watch for:** every `Write` tool call in this project has a history of appending a stray literal `</content>` line at the end of the file. After every `Write` call below, run `tail -3 <file>` to check for it and strip it with `sed -i '' -e '/^<\/content>$/d' <file>` if present, before moving on.

**Test infrastructure note:** a separate, parallel plan (`docs/superpowers/plans/2026-08-03-automated-test-suite.md`) is mid-execution. As of this plan being written, its Task 3 (Vitest install + config) is done — `npm test` (unit project, `src/**/*.test.ts`) works — but its Tasks 5+ (integration test helpers under `tests/integration/`) are not built yet. This plan's one true unit-testable piece (Task 4 below) uses real Vitest TDD. Everything else that would ideally get an integration test instead uses the same substitution every earlier plan in this repo used before a runner existed: `npx tsc --noEmit` and `npx eslint <file>` as the "step passes" signal, plus a manual verification instruction. Do not wait on the other plan to finish — check `ls tests/integration/` at the start of Task 3 in case it has landed by the time you execute this, but proceed with the substitution if it hasn't.

**Supabase project ref for MCP tools:** `ucnfcsosbdgknmzyuqbw` (same live project used by every prior migration this session).

---

### Task 1: Migration — link attachments to run cases

**Files:**
- Create: `supabase/migrations/0019_link_attachments_to_run_cases.sql`

- [x] **Step 1: Write the migration**

Create `supabase/migrations/0019_link_attachments_to_run_cases.sql`:

```sql
-- Lets testers attach screenshots to a specific run execution while still
-- surfacing them on the test case's own Attachments panel. run_case_id is
-- additive metadata only — RLS stays keyed off test_case_id exactly as
-- before, since a run_case always belongs to the same test_case anyway.

alter table test_case_attachments
  add column run_case_id uuid references test_run_cases(id) on delete set null;

create index test_case_attachments_run_case_id_idx on test_case_attachments(run_case_id);
```

- [x] **Step 2: Apply the migration to the live project**

Use the Supabase MCP `apply_migration` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`, `name: "link_attachments_to_run_cases"`, and the SQL above as `query`.

- [x] **Step 3: Verify the column and index exist**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select column_name, is_nullable, data_type
from information_schema.columns
where table_name = 'test_case_attachments' and column_name = 'run_case_id';
```

Expected: one row, `is_nullable = 'YES'`, `data_type = 'uuid'`.

```sql
select indexname from pg_indexes where tablename = 'test_case_attachments';
```

Expected: includes both `test_case_attachments_test_case_id_idx` (existing) and `test_case_attachments_run_case_id_idx` (new).

- [x] **Step 4: Run the security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`. Expected: the same pre-existing, already-reviewed items as before this migration (rate_limit_buckets RLS-no-policy, SECURITY DEFINER warnings, leaked-password-protection) — no new items, since this migration adds no new table, function, or policy.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/0019_link_attachments_to_run_cases.sql
git commit -m "Link test case attachments to the run case that produced them"
```

---

### Task 2: Regenerate TypeScript types

**Files:**
- Modify: `src/lib/types/database.ts`

- [x] **Step 1: Regenerate types from the live schema**

Use the Supabase MCP `generate_typescript_types` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`.

- [x] **Step 2: Patch the `test_case_attachments` type block**

In `src/lib/types/database.ts`, find the existing `test_case_attachments` block (currently at lines 398-435) and add `run_case_id` to `Row`, `Insert`, `Update`, and a new entry to `Relationships`, matching the generated output:

```ts
      test_case_attachments: {
        Row: {
          file_name: string
          file_size: number | null
          id: string
          run_case_id: string | null
          storage_path: string
          test_case_id: string
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          file_name: string
          file_size?: number | null
          id?: string
          run_case_id?: string | null
          storage_path: string
          test_case_id: string
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          file_name?: string
          file_size?: number | null
          id?: string
          run_case_id?: string | null
          storage_path?: string
          test_case_id?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_case_attachments_run_case_id_fkey"
            columns: ["run_case_id"]
            isOneToOne: false
            referencedRelation: "test_run_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_case_attachments_test_case_id_fkey"
            columns: ["test_case_id"]
            isOneToOne: false
            referencedRelation: "test_cases"
            referencedColumns: ["id"]
          },
        ]
      }
```

(Relationships entries are alphabetized by `foreignKeyName` in this codebase's existing generated output — `run_case_id_fkey` sorts before `test_case_id_fkey`.)

- [x] **Step 3: Verify the type compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [x] **Step 4: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "Regenerate types for test_case_attachments.run_case_id"
```

---

### Task 3: Extend `uploadAttachment` to accept an optional run case

**Files:**
- Modify: `src/lib/actions/attachments.ts:16-63`

- [x] **Step 1: Check whether integration test infra has landed yet**

Run: `ls tests/integration/ 2>&1`
If this lists files (rather than "No such file or directory"), the parallel test-suite plan has progressed further than expected — stop and re-read this plan's header note before continuing, since a real integration test may now be possible instead of the manual verification in Step 4 below. If it still doesn't exist, proceed with Steps 2-4 as written.

- [x] **Step 2: Extend the action**

Replace `src/lib/actions/attachments.ts` lines 16-63 (the full `uploadAttachment` function) with:

```ts
export async function uploadAttachment(
  projectId: string,
  testCaseId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { error: "File is too large — max 10 MB." };
  }

  const runCaseIdRaw = formData.get("runCaseId");
  const runCaseId =
    typeof runCaseIdRaw === "string" && runCaseIdRaw.length > 0 ? runCaseIdRaw : null;

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("upload_attachment", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  if (runCaseId) {
    const { data: runCase, error: runCaseError } = await supabase
      .from("test_run_cases")
      .select("test_case_id")
      .eq("id", runCaseId)
      .single();
    if (runCaseError || !runCase || runCase.test_case_id !== testCaseId) {
      return { error: "This run result doesn't belong to this test case." };
    }
  }

  const storagePath = `${projectId}/${testCaseId}/${crypto.randomUUID()}-${sanitizeFileName(
    file.name
  )}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined });

  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await supabase.from("test_case_attachments").insert({
    test_case_id: testCaseId,
    run_case_id: runCaseId,
    storage_path: storagePath,
    file_name: file.name,
    file_size: file.size,
    uploaded_by: ctx.userId,
  });

  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { error: insertError.message };
  }

  revalidatePath(`/projects/${projectId}/test-cases/${testCaseId}`);
  return {};
}
```

The only behavioral change when `runCaseId` is absent (the existing test-case-detail-page upload path) is the new `run_case_id: null` in the insert, which is the column's default-equivalent value — no change in observable behavior for existing callers.

- [x] **Step 3: Verify nothing broke**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/attachments.ts`
Expected: no output.

- [x] **Step 4: Manual verification of the ownership check**

With the local Supabase stack running (`npx supabase status` should show it reachable — if not, run `npx supabase start` first), use the Supabase MCP `execute_sql` tool against the **local** stack is not available via MCP (MCP only targets the live project `ucnfcsosbdgknmzyuqbw`), so instead verify this logically by reading the code: the `.eq("id", runCaseId).single()` lookup is scoped by RLS to run-cases the authenticated user's org can see at all (via the existing "members can view run cases" policy), and the subsequent `runCase.test_case_id !== testCaseId` comparison rejects any run case — even one the user CAN see — whose `test_case_id` doesn't match the `testCaseId` argument the caller (the UI) is claiming. Confirm this by re-reading the diff from Step 2 and checking the comparison is present and correct before committing.

- [x] **Step 5: Commit**

```bash
git add src/lib/actions/attachments.ts
git commit -m "Let uploadAttachment tag a screenshot with the run case that produced it"
```

---

### Task 4: Clipboard image detection helper (real TDD)

**Files:**
- Create: `src/lib/clipboard.ts`
- Test: `src/lib/clipboard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/clipboard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clipboardItemsToImageFile } from "./clipboard";

describe("clipboardItemsToImageFile", () => {
  it("returns the file from the first image item", () => {
    const imageFile = {} as File;
    const items = [
      { type: "text/plain", getAsFile: () => null },
      { type: "image/png", getAsFile: () => imageFile },
    ];
    expect(clipboardItemsToImageFile(items)).toBe(imageFile);
  });

  it("returns null when no item is an image", () => {
    const items = [
      { type: "text/plain", getAsFile: () => null },
      { type: "text/html", getAsFile: () => null },
    ];
    expect(clipboardItemsToImageFile(items)).toBeNull();
  });

  it("returns null for an empty items array", () => {
    expect(clipboardItemsToImageFile([])).toBeNull();
  });

  it("matches image subtypes generically (png, gif, webp, etc.)", () => {
    const gifFile = {} as File;
    const items = [{ type: "image/gif", getAsFile: () => gifFile }];
    expect(clipboardItemsToImageFile(items)).toBe(gifFile);
  });

  it("skips a null getAsFile result for a matching image item and returns null", () => {
    const items = [{ type: "image/png", getAsFile: () => null }];
    expect(clipboardItemsToImageFile(items)).toBeNull();
  });
});
```

Check for the stray `</content>` line per the known Write-tool quirk: `tail -3 src/lib/clipboard.test.ts`.

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test`
Expected: FAIL — `src/lib/clipboard.ts` doesn't exist yet, so the import fails.

- [ ] **Step 3: Write the implementation**

Create `src/lib/clipboard.ts`:

```ts
export interface ClipboardImageItem {
  type: string;
  getAsFile: () => File | null;
}

export function clipboardItemsToImageFile(items: ClipboardImageItem[]): File | null {
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}
```

Check for the stray `</content>` line: `tail -3 src/lib/clipboard.ts`.

The `ClipboardImageItem` interface deliberately duck-types the two members this function actually uses from the DOM's `DataTransferItem`, rather than importing that DOM type directly — this keeps the function testable with plain objects in Vitest's `node` test environment, which has no real `DataTransferItem`. The real call site (Task 8) passes `Array.from(event.clipboardData.items)`, which structurally satisfies this interface.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test`
Expected: PASS — all 5 tests in `src/lib/clipboard.test.ts` green.

- [ ] **Step 5: Verify nothing else broke**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/clipboard.ts src/lib/clipboard.test.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/clipboard.ts src/lib/clipboard.test.ts
git commit -m "Add clipboardItemsToImageFile helper with unit tests"
```

---

### Task 5: Load run-case attachments in the runs page query

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/runs/[runId]/page.tsx:25-55`
- Modify: `src/components/runs/run-executor.tsx:12-23` (the `RunCaseItem` interface)

- [ ] **Step 1: Add the attachment type to `run-executor.tsx`**

In `src/components/runs/run-executor.tsx`, replace the `RunCaseItem` interface (currently lines 12-23):

```ts
export interface RunCaseAttachmentItem {
  id: string;
  fileName: string;
  fileSize: number | null;
  storagePath: string;
  downloadUrl: string | null;
}

export interface RunCaseItem {
  id: string;
  status: RunCaseStatus;
  notes: string | null;
  test_case: {
    id: string;
    title: string;
    preconditions: string | null;
    steps: TestStep[];
    feature: string | null;
  };
  attachments: RunCaseAttachmentItem[];
}
```

- [ ] **Step 2: Extend the runs page query**

In `src/app/(app)/projects/[projectId]/runs/[runId]/page.tsx`, replace lines 25-55 (the `runCases` query and `items` mapping) with:

```ts
  const { data: runCases } = await supabase
    .from("test_run_cases")
    .select(
      "id, status, notes, test_cases(id, title, preconditions, steps, test_case_features(name)), test_case_attachments(id, file_name, file_size, storage_path)"
    )
    .eq("run_id", runId)
    .order("order_index");

  // postgrest-js infers many-to-one embeds as arrays without generated
  // Relationships metadata; test_run_cases.test_case_id -> test_cases.id is
  // actually one row, so unwrap it.
  const items: RunCaseItem[] = await Promise.all(
    (runCases ?? []).map(async (rc) => {
      const testCase = Array.isArray(rc.test_cases) ? rc.test_cases[0] : rc.test_cases;
      const linkedFeature = testCase.test_case_features as
        | { name: string }
        | { name: string }[]
        | null;
      const feature = Array.isArray(linkedFeature) ? linkedFeature[0]?.name : linkedFeature?.name;
      const attachments = await Promise.all(
        (rc.test_case_attachments ?? []).map(async (a) => {
          const { data: signed } = await supabase.storage
            .from("test-case-attachments")
            .createSignedUrl(a.storage_path, 300);
          return {
            id: a.id,
            fileName: a.file_name,
            fileSize: a.file_size,
            storagePath: a.storage_path,
            downloadUrl: signed?.signedUrl ?? null,
          };
        })
      );
      return {
        id: rc.id,
        status: rc.status,
        notes: rc.notes,
        test_case: {
          id: testCase.id,
          title: testCase.title,
          preconditions: testCase.preconditions,
          steps: testCase.steps as RunCaseItem["test_case"]["steps"],
          feature: feature ?? null,
        },
        attachments,
      };
    })
  );
```

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output (note: `run-executor.tsx` now expects `attachments` on every `RunCaseItem` — this step confirms the page supplies it).

Run: `npx eslint "src/app/(app)/projects/[projectId]/runs/[runId]/page.tsx" src/components/runs/run-executor.tsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/runs/[runId]/page.tsx" src/components/runs/run-executor.tsx
git commit -m "Load run-case attachments alongside test cases in the runs page query"
```

---

### Task 6: `RunCaseScreenshots` component

**Files:**
- Create: `src/components/runs/run-case-screenshots.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/runs/run-case-screenshots.tsx`:

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { uploadAttachment, deleteAttachment } from "@/lib/actions/attachments";
import type { RunCaseAttachmentItem } from "@/components/runs/run-executor";

export function RunCaseScreenshots({
  projectId,
  testCaseId,
  runCaseId,
  attachments,
}: {
  projectId: string;
  testCaseId: string;
  runCaseId: string;
  attachments: RunCaseAttachmentItem[];
}) {
  const router = useRouter();
  const [isUploading, startUpload] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function uploadFile(file: File) {
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("runCaseId", runCaseId);
    startUpload(async () => {
      const result = await uploadAttachment(projectId, testCaseId, {}, formData);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete(attachmentId: string, storagePath: string) {
    setPendingDeleteIds((prev) => [...prev, attachmentId]);
    void deleteAttachment(projectId, testCaseId, attachmentId, storagePath).then(() => {
      router.refresh();
    });
  }

  const visible = attachments.filter((a) => !pendingDeleteIds.includes(a.id));

  return (
    <div>
      <div className="mb-1 text-xs font-ui-label font-semibold uppercase tracking-wide text-ink-tertiary">
        Screenshots
      </div>
      <div className="flex h-16 flex-wrap items-start gap-1.5">
        {visible.map((a) => (
          <div
            key={a.id}
            className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border-light"
          >
            {a.downloadUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.downloadUrl} alt={a.fileName} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-paper-muted text-ink-tertiary">
                <ImagePlus size={14} />
              </div>
            )}
            <button
              type="button"
              onClick={() => handleDelete(a.id, a.storagePath)}
              className="absolute inset-0 hidden items-center justify-center bg-black/50 text-white group-hover:flex"
              aria-label={`Remove ${a.fileName}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashed border-border-medium text-ink-tertiary hover:border-primary hover:text-primary disabled:opacity-60"
          aria-label="Add screenshot"
        >
          {isUploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            files.forEach(uploadFile);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
      </div>
      {error && <p className="mt-1 text-xs text-fail">{error}</p>}
    </div>
  );
}
```

Check for the stray `</content>` line: `tail -3 src/components/runs/run-case-screenshots.tsx`.

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/runs/run-case-screenshots.tsx`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/runs/run-case-screenshots.tsx
git commit -m "Add RunCaseScreenshots component (thumbnail strip + file-picker upload)"
```

---

### Task 7: Wire `RunCaseScreenshots` into the run executor layout

**Files:**
- Modify: `src/components/runs/run-executor.tsx:194-201`

- [ ] **Step 1: Import the new component**

In `src/components/runs/run-executor.tsx`, add to the imports (near the other local imports):

```ts
import { RunCaseScreenshots } from "@/components/runs/run-case-screenshots";
```

- [ ] **Step 2: Replace the notes textarea block with the side-by-side layout**

Replace the existing textarea block (currently lines 194-201):

```tsx
        <textarea
          ref={notesRef}
          key={current.id}
          defaultValue={current.notes ?? ""}
          placeholder="Add observations or failure details here…"
          rows={2}
          className="mb-4 block w-full rounded-xl border border-border-light bg-paper-muted/50 px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
        />
```

with:

```tsx
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-[2]">
            <div className="mb-1 text-xs font-ui-label font-semibold uppercase tracking-wide text-ink-tertiary">
              Notes
            </div>
            <textarea
              ref={notesRef}
              key={current.id}
              defaultValue={current.notes ?? ""}
              placeholder="Add observations or failure details here… (paste a screenshot too — ⌘V)"
              rows={2}
              className="block w-full rounded-xl border border-border-light bg-paper-muted/50 px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
            />
          </div>
          <div className="flex-1">
            <RunCaseScreenshots
              key={current.id}
              projectId={projectId}
              testCaseId={current.test_case.id}
              runCaseId={current.id}
              attachments={cases[index]?.attachments ?? []}
            />
          </div>
        </div>
```

`attachments` is read from the `cases` prop (not the local `items` state that `current` comes from) deliberately: `RunCaseScreenshots` has no internal state mirroring the attachment list, so it re-renders correctly from fresh server data whenever `router.refresh()` causes the parent Server Component to re-run and pass new `cases` down — reading from `items`/`current` instead would show stale data, since that local array is only mutated manually by `applyStatus` for status/notes, never for attachments.

- [ ] **Step 3: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/runs/run-executor.tsx`
Expected: no output.

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/runs/run-executor.tsx
git commit -m "Show screenshots side-by-side with notes in the run executor"
```

---

### Task 8: Clipboard paste handling

**Files:**
- Modify: `src/components/runs/run-executor.tsx` (imports + new `useEffect`)

- [ ] **Step 1: Add imports**

In `src/components/runs/run-executor.tsx`, add:

```ts
import { uploadAttachment } from "@/lib/actions/attachments";
import { clipboardItemsToImageFile } from "@/lib/clipboard";
```

- [ ] **Step 2: Add paste-upload state and the paste listener**

Immediately after the existing keyboard-shortcut `useEffect` (currently lines 99-112, the one that calls `applyStatus` on Enter/F/B/S and navigates with arrow keys), add a new `useEffect`:

```tsx
  const [isPastingScreenshot, setIsPastingScreenshot] = useState(false);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData || !current) return;
      const items = Array.from(e.clipboardData.items).map((item) => ({
        type: item.type,
        getAsFile: () => item.getAsFile(),
      }));
      const file = clipboardItemsToImageFile(items);
      if (!file) return;
      e.preventDefault();
      setIsPastingScreenshot(true);
      const formData = new FormData();
      formData.set("file", file, file.name || "screenshot.png");
      formData.set("runCaseId", current.id);
      startTransition(async () => {
        const result = await uploadAttachment(projectId, current.test_case.id, {}, formData);
        setIsPastingScreenshot(false);
        if (!result.error) {
          router.refresh();
        }
      });
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);
```

This mirrors the existing keyboard-shortcut listener's lifecycle pattern exactly (window-level listener added/removed via `useEffect`, re-attached whenever the active case changes so the closure always captures the current `current.id`). Unlike the keyboard-shortcut listener, this one does **not** need a `document.activeElement === notesRef.current` guard: a plain text paste (the normal case when the notes textarea has focus) never has an `image/*` clipboard item, so `clipboardItemsToImageFile` returns `null` and the function returns early before calling `preventDefault()` — default paste behavior (inserting text into the focused field) proceeds untouched.

Reusing the existing `isPending`/`startTransition` (shared with `applyStatus`) means the Pass/Fail/Blocked/Skip buttons show their disabled state during a paste-triggered upload too — this is an intentional, harmless side effect, not a bug.

- [ ] **Step 3: Show a lightweight pasting indicator**

Immediately after the closing `</div>` of the notes/screenshots row added in Task 7 (before the status buttons `<div className="flex gap-3">`), add:

```tsx
        {isPastingScreenshot && (
          <p className="mb-2 text-xs text-ink-tertiary">Uploading pasted screenshot…</p>
        )}
```

- [ ] **Step 4: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/runs/run-executor.tsx`
Expected: no output.

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/runs/run-executor.tsx
git commit -m "Support pasting a screenshot directly into the run executor"
```

---

### Task 9: "from Run" tag on the test case Attachments panel

**Files:**
- Modify: `src/components/test-cases/attachments-panel.tsx`
- Modify: `src/app/(app)/projects/[projectId]/test-cases/[testCaseId]/page.tsx:58-78`

- [ ] **Step 1: Add `runName` to `AttachmentRow`**

In `src/components/test-cases/attachments-panel.tsx`, replace the `AttachmentRow` interface (currently lines 9-16):

```ts
export interface AttachmentRow {
  id: string;
  storagePath: string;
  fileName: string;
  fileSize: number | null;
  uploadedAt: string;
  downloadUrl: string | null;
  runName: string | null;
}
```

- [ ] **Step 2: Render the tag**

In the same file, replace the attachment row's link block (currently lines 46-54):

```tsx
              <a
                href={a.downloadUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1.5 text-ink-primary hover:text-primary"
              >
                <Paperclip size={14} className="shrink-0" />
                <span className="truncate">{a.fileName}</span>
              </a>
```

with:

```tsx
              <a
                href={a.downloadUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1.5 text-ink-primary hover:text-primary"
              >
                <Paperclip size={14} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate">{a.fileName}</span>
                  {a.runName && (
                    <span className="block text-[10px] font-normal uppercase tracking-wide text-ink-tertiary">
                      from Run: {a.runName}
                    </span>
                  )}
                </span>
              </a>
```

- [ ] **Step 3: Join run info in the test case detail page query**

In `src/app/(app)/projects/[projectId]/test-cases/[testCaseId]/page.tsx`, replace lines 58-78 (the `attachmentRows` query and `attachments` mapping):

```ts
  const { data: attachmentRows } = await supabase
    .from("test_case_attachments")
    .select(
      "id, storage_path, file_name, file_size, uploaded_at, test_run_cases(test_runs(name))"
    )
    .eq("test_case_id", testCaseId)
    .order("uploaded_at", { ascending: false });

  const attachments = await Promise.all(
    (attachmentRows ?? []).map(async (a) => {
      const { data: signed } = await supabase.storage
        .from("test-case-attachments")
        .createSignedUrl(a.storage_path, 300);
      const runCase = Array.isArray(a.test_run_cases) ? a.test_run_cases[0] : a.test_run_cases;
      const run = runCase
        ? Array.isArray(runCase.test_runs)
          ? runCase.test_runs[0]
          : runCase.test_runs
        : null;
      return {
        id: a.id,
        storagePath: a.storage_path,
        fileName: a.file_name,
        fileSize: a.file_size,
        uploadedAt: a.uploaded_at,
        downloadUrl: signed?.signedUrl ?? null,
        runName: run?.name ?? null,
      };
    })
  );
```

(Same array-unwrap idiom already used twice elsewhere in this codebase for nullable one-to-one-via-many-side embeds — see the comment in `runs/[runId]/page.tsx`.)

- [ ] **Step 4: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/test-cases/attachments-panel.tsx "src/app/(app)/projects/[projectId]/test-cases/[testCaseId]/page.tsx"`
Expected: no output.

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/test-cases/attachments-panel.tsx "src/app/(app)/projects/[projectId]/test-cases/[testCaseId]/page.tsx"
git commit -m 'Show a "from Run" tag on attachments captured during a run'
```

---

### Task 10: Full verification pass and docs

**Files:**
- Modify: `README.md`
- Modify: `docs/build-status.md`

- [ ] **Step 1: Full automated verification**

Run each of these and confirm the stated expectation:

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
npx eslint .
```
Expected: no new errors/warnings beyond any pre-existing accepted ones (e.g. the known `sendIssueToJira` unused-params warning from the Jira project).

```bash
npm test
```
Expected: all unit tests pass, including the 5 new `clipboardItemsToImageFile` tests.

```bash
npm run build
```
Expected: production build succeeds.

```bash
git status --short
```
Expected: clean (everything from Tasks 1-9 already committed).

- [ ] **Step 2: Manual browser walkthrough (write these instructions, do not attempt to execute them — this environment has no way to log into the live app)**

Add a short walkthrough to this task's commit message body or the final report, for the user to run themselves once this plan is fully executed:

1. Open a run that has at least one pending test case (`Projects → [a project] → Runs → [a run]`).
2. With the run executor open, take a screenshot (any OS screenshot shortcut) and paste it (Cmd/Ctrl+V) anywhere on the page *except* inside the notes textarea. Expected: a thumbnail appears in the "Screenshots" column within a second or two, with a brief "Uploading pasted screenshot…" message beforehand.
3. Paste the same screenshot again while the notes textarea *is* focused. Expected: same result — a thumbnail appears — proving the paste interception works regardless of focus.
4. Select some text somewhere on the page, copy it, and paste it into the notes textarea. Expected: the text is inserted normally; no upload is triggered, no error appears.
5. Click the "+" tile and pick an image file via the OS file picker. Expected: a second thumbnail appears.
6. Hover a thumbnail and click the trash icon that appears. Expected: the thumbnail disappears.
7. Navigate to that test case's own detail page (`Test Cases → [the test case]`). Expected: the Attachments panel on the right shows the screenshot(s) that weren't deleted, each with a small "from Run: [run name]" tag underneath the filename. Upload a file directly from this page (existing flow) and confirm it does *not* get a "from Run" tag.
8. Try uploading a file over 10MB from either location. Expected: the existing "File is too large — max 10 MB" error still appears, unchanged.

- [ ] **Step 3: Update README.md**

Read the current `README.md` in full first (don't assume its structure hasn't shifted since the last edit). Find the section listing shipped features (near where test-case attachments and the Jira integration are already documented) and add a bullet:

```markdown
- Attach screenshots to a test case directly from the Runs screen (file picker or clipboard paste) — evidence is tagged to the run execution and also shows up on the test case's own Attachments panel.
```

- [ ] **Step 4: Update docs/build-status.md**

Read the current `docs/build-status.md` in full first. Add this feature to the "Shipped and working" list, in the same style as neighboring entries, near the existing test-case-attachments and run-execution entries.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/build-status.md
git commit -m "Document run evidence attachments in README and build status"
```
