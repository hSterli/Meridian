# Custom Fields on Test Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `test_cases.custom_fields` (a jsonb column that has existed since migration `0001_init.sql` but has never been read or written anywhere) real: let each project define its own custom fields (text/number/select), set them per test case, see them on the list, filter by the select ones, and round-trip them through CSV export/import.

**Architecture:** A new project-scoped `test_case_custom_fields` table (mirroring the existing `test_case_features` table exactly — same RLS treatment, same "project manages its own list" shape) holds field *definitions*. Field *values* live in the existing `test_cases.custom_fields` jsonb column, keyed by field id (not name), so renaming a field never orphans data. A new dedicated management page lets a project admin add/edit/delete field definitions. The test case form, list view, filters, and CSV export/import all read those definitions and render/validate/round-trip dynamically instead of having one hardcoded code path per field.

**Tech Stack:** Next.js 16 App Router (Server Actions + Server Components), Supabase (Postgres/RLS), TypeScript. This repo has no automated test runner configured yet (a separate, not-yet-implemented project) — every task below substitutes the codebase's actual established verification habit (`npx tsc --noEmit`, `npx eslint <file>`, and a final `npm run build` + Supabase advisors check) for the write-test/run-test/pass loop this skill normally prescribes. This is a deliberate substitution, not an oversight: writing Vitest-shaped steps against a framework that isn't installed would produce steps that can't actually run.

**Known repo quirk to watch for:** every `Write` tool call in this project has a history of appending a stray literal `</content>` line at the end of the file. After every `Write` call below, run `tail -3 <file>` to check for it and strip it with `sed -i '' -e '/^<\/content>$/d' <file>` if present, before moving on.

---

### Task 1: Migration — `test_case_custom_fields` table

**Files:**
- Create: `supabase/migrations/0015_test_case_custom_fields.sql`

- [x] **Step 1: Write the migration**

```sql
-- Custom field DEFINITIONS, project-scoped, mirroring test_case_features'
-- structure and RLS treatment exactly. Field VALUES live in the existing
-- test_cases.custom_fields jsonb column (present since 0001_init.sql, never
-- used until now), keyed by this table's id — not name — so renaming a
-- field later doesn't orphan already-stored values.

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

- [x] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`, `name: "test_case_custom_fields"`, and the SQL above as `query`.

- [x] **Step 3: Verify the table exists and RLS is on**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select relname, relrowsecurity from pg_class where relname = 'test_case_custom_fields';
```

Expected: one row, `relrowsecurity = true`.

- [x] **Step 4: Run the security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`. Expected: the same four pre-existing, already-reviewed items as before (rate_limit_buckets RLS-no-policy, three SECURITY DEFINER warnings, leaked-password-protection) — no new items.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/0015_test_case_custom_fields.sql
git commit -m "Add test_case_custom_fields table for custom field definitions"
```

---

### Task 2: Regenerate and merge TypeScript types

**Files:**
- Modify: `src/lib/types/database.ts`

- [x] **Step 1: Regenerate types from the live schema**

Use the Supabase MCP `generate_typescript_types` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`.

- [x] **Step 2: Add the new table type to `database.ts`**

In the `Tables` block, insert alphabetically (before `test_case_features`, matching the existing alphabetical ordering of table keys):

```ts
      test_case_custom_fields: {
        Row: {
          created_at: string
          display_order: number
          field_type: Database["public"]["Enums"]["test_case_custom_field_type"]
          id: string
          name: string
          options: Json
          project_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          field_type: Database["public"]["Enums"]["test_case_custom_field_type"]
          id?: string
          name: string
          options?: Json
          project_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          field_type?: Database["public"]["Enums"]["test_case_custom_field_type"]
          id?: string
          name?: string
          options?: Json
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_case_custom_fields_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [x] **Step 3: Add the new enum**

In the `Enums` block (inside `Database["public"]["Enums"]`), add alphabetically before `test_case_priority`:

```ts
      test_case_custom_field_type: "text" | "number" | "select"
```

- [x] **Step 4: Add the enum to the `Constants` block**

In `export const Constants = { public: { Enums: { ... } } }`, add before `test_case_priority`:

```ts
      test_case_custom_field_type: ["text", "number", "select"],
```

- [x] **Step 5: Add a convenience alias**

At the bottom of the file, in the "App-level convenience aliases" section, add after `TestCaseAutomationStatus`:

```ts
export type TestCaseCustomFieldType = Enums<"test_case_custom_field_type">;
```

- [x] **Step 6: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [x] **Step 7: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "Regenerate types for test_case_custom_fields"
```

---

### Task 3: Server Actions for custom field definitions

**Files:**
- Create: `src/lib/actions/custom-fields.ts`

- [x] **Step 1: Write the actions**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import type { TestCaseCustomFieldType } from "@/lib/types/database";
import type { ActionState } from "@/lib/actions/auth";

const FIELD_TYPES: TestCaseCustomFieldType[] = ["text", "number", "select"];

function parseOptions(raw: string): string[] {
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export async function createCustomField(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const fieldType = String(formData.get("fieldType") ?? "text");
  const optionsRaw = String(formData.get("options") ?? "");

  if (!name) return { error: "Field name is required." };
  if (!(FIELD_TYPES as string[]).includes(fieldType)) return { error: "Invalid field type." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("create_custom_field", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();
  const options = fieldType === "select" ? parseOptions(optionsRaw) : [];

  const { error } = await supabase.from("test_case_custom_fields").insert({
    project_id: projectId,
    name,
    field_type: fieldType as TestCaseCustomFieldType,
    options,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: `A custom field named "${name}" already exists in this project.` };
    }
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/test-cases/custom-fields`);
  revalidatePath(`/projects/${projectId}/test-cases`);
  return {};
}

export async function updateCustomField(
  projectId: string,
  fieldId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const optionsRaw = String(formData.get("options") ?? "");

  if (!name) return { error: "Field name is required." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("update_custom_field", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("test_case_custom_fields")
    .select("field_type")
    .eq("id", fieldId)
    .single();

  if (!existing) return { error: "Custom field not found." };

  const options = existing.field_type === "select" ? parseOptions(optionsRaw) : [];

  const { error } = await supabase
    .from("test_case_custom_fields")
    .update({ name, options })
    .eq("id", fieldId);

  if (error) {
    if (error.code === "23505") {
      return { error: `A custom field named "${name}" already exists in this project.` };
    }
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/test-cases/custom-fields`);
  revalidatePath(`/projects/${projectId}/test-cases`);
  return {};
}

export async function deleteCustomField(projectId: string, fieldId: string) {
  const supabase = await createClient();
  await supabase.from("test_case_custom_fields").delete().eq("id", fieldId);
  revalidatePath(`/projects/${projectId}/test-cases/custom-fields`);
  revalidatePath(`/projects/${projectId}/test-cases`);
}
```

Note: `deleteCustomField` doesn't show a confirmation dialog before deleting, matching this app's existing (if inconsistent) convention — every single-item delete in this codebase today (test case, suite, attachment) skips confirmation; only bulk-delete-runs has one. Not fixing that inconsistency here — it's a separate, already-tracked issue.

- [x] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/custom-fields.ts`
Expected: no output.

- [x] **Step 3: Commit**

```bash
git add src/lib/actions/custom-fields.ts
git commit -m "Add Server Actions for custom field definitions"
```

---

### Task 4: Custom fields management UI

**Files:**
- Create: `src/components/test-cases/custom-fields-manager.tsx`
- Create: `src/app/(app)/projects/[projectId]/test-cases/custom-fields/page.tsx`

- [x] **Step 1: Write the manager component**

```tsx
"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ActionState } from "@/lib/actions/auth";
import type { TestCaseCustomFieldType } from "@/lib/types/database";

export interface CustomFieldRow {
  id: string;
  name: string;
  field_type: TestCaseCustomFieldType;
  options: string[];
}

export function CustomFieldsManager({
  fields,
  createAction,
  updateAction,
  deleteAction,
}: {
  fields: CustomFieldRow[];
  createAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (
    fieldId: string,
    prevState: ActionState,
    formData: FormData
  ) => Promise<ActionState>;
  deleteAction: (fieldId: string) => void;
}) {
  return (
    <div className="space-y-6">
      <Card className="divide-y divide-border-light">
        {fields.length === 0 && (
          <p className="p-4 text-sm text-ink-tertiary">No custom fields yet — add one below.</p>
        )}
        {fields.map((field) => (
          <CustomFieldEditRow
            key={field.id}
            field={field}
            updateAction={updateAction}
            deleteAction={deleteAction}
          />
        ))}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-secondary">Add a custom field</h2>
        <NewCustomFieldForm createAction={createAction} />
      </Card>
    </div>
  );
}

function CustomFieldEditRow({
  field,
  updateAction,
  deleteAction,
}: {
  field: CustomFieldRow;
  updateAction: (
    fieldId: string,
    prevState: ActionState,
    formData: FormData
  ) => Promise<ActionState>;
  deleteAction: (fieldId: string) => void;
}) {
  const boundUpdate = updateAction.bind(null, field.id);
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(boundUpdate, {});

  return (
    <form action={formAction} className="flex items-start gap-3 px-4 py-3">
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Input name="name" defaultValue={field.name} className="flex-1" />
          <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[11px] font-ui-label font-bold uppercase tracking-wide text-ink-tertiary">
            {field.field_type}
          </span>
        </div>
        {field.field_type === "select" && (
          <Input
            name="options"
            defaultValue={field.options.join(", ")}
            placeholder="Comma-separated options"
          />
        )}
        {state.error && <p className="text-xs text-fail">{state.error}</p>}
      </div>
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
      <button
        type="button"
        onClick={() => deleteAction(field.id)}
        className="mt-2 text-ink-tertiary hover:text-fail"
        aria-label={`Delete ${field.name}`}
      >
        <Trash2 size={16} />
      </button>
    </form>
  );
}

function NewCustomFieldForm({
  createAction,
}: {
  createAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(createAction, {});
  const [fieldType, setFieldType] = useState<TestCaseCustomFieldType>("text");

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="newFieldName">Name</Label>
          <Input id="newFieldName" name="name" required placeholder="e.g. Component" />
        </div>
        <div>
          <Label htmlFor="newFieldType">Type</Label>
          <Select
            id="newFieldType"
            name="fieldType"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as TestCaseCustomFieldType)}
            className="w-full"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="select">Dropdown</option>
          </Select>
        </div>
      </div>
      {fieldType === "select" && (
        <div>
          <Label htmlFor="newFieldOptions">Options (comma-separated)</Label>
          <Input id="newFieldOptions" name="options" placeholder="Frontend, Backend, API" />
        </div>
      )}
      {state.error && <p className="text-xs text-fail">{state.error}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Adding…" : "Add field"}
      </Button>
    </form>
  );
}
```

- [x] **Step 2: Write the management page**

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CustomFieldsManager } from "@/components/test-cases/custom-fields-manager";
import { createCustomField, updateCustomField, deleteCustomField } from "@/lib/actions/custom-fields";
import type { TestCaseCustomFieldType } from "@/lib/types/database";

export default async function CustomFieldsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: fields } = await supabase
    .from("test_case_custom_fields")
    .select("id, name, field_type, options")
    .eq("project_id", projectId)
    .order("display_order")
    .order("created_at");

  const createAction = createCustomField.bind(null, projectId);
  const updateAction = updateCustomField.bind(null, projectId);
  const deleteAction = deleteCustomField.bind(null, projectId);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Custom fields"
        description="Define per-project fields that show up on every test case."
        action={
          <Link
            href={`/projects/${projectId}/test-cases`}
            className="text-sm font-medium text-primary hover:text-primary"
          >
            ← Back to Test Cases
          </Link>
        }
      />
      <CustomFieldsManager
        fields={(fields ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          field_type: f.field_type as TestCaseCustomFieldType,
          options: (f.options as string[]) ?? [],
        }))}
        createAction={createAction}
        updateAction={updateAction}
        deleteAction={deleteAction}
      />
    </div>
  );
}
```

- [x] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/test-cases/custom-fields-manager.tsx "src/app/(app)/projects/[projectId]/test-cases/custom-fields/page.tsx"`
Expected: no output.

- [x] **Step 4: Commit**

```bash
git add src/components/test-cases/custom-fields-manager.tsx "src/app/(app)/projects/[projectId]/test-cases/custom-fields/page.tsx"
git commit -m "Add custom fields management page"
```

---

### Task 5: Link to the management page from Test Cases

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/test-cases/page.tsx:1-9` (imports), `:274-285` (Quick actions card)

- [x] **Step 1: Add the icon import**

In the top import block, change:

```ts
import { Sparkles, PieChart, Download } from "lucide-react";
```

to:

```ts
import { Sparkles, PieChart, Download, SlidersHorizontal } from "lucide-react";
```

- [x] **Step 2: Add the link inside the existing "Quick actions" card**

Find:

```tsx
          <Card className="p-3">
            <p className="font-ui-label text-xs font-bold uppercase tracking-wide text-ink-tertiary">
              Quick actions
            </p>
            <a
              href={`/projects/${projectId}/test-cases/export`}
              className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-paper-muted hover:text-ink-primary"
            >
              <Download size={14} />
              Export as CSV
            </a>
          </Card>
```

Replace with:

```tsx
          <Card className="p-3">
            <p className="font-ui-label text-xs font-bold uppercase tracking-wide text-ink-tertiary">
              Quick actions
            </p>
            <a
              href={`/projects/${projectId}/test-cases/export`}
              className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-paper-muted hover:text-ink-primary"
            >
              <Download size={14} />
              Export as CSV
            </a>
            <Link
              href={`/projects/${projectId}/test-cases/custom-fields`}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-paper-muted hover:text-ink-primary"
            >
              <SlidersHorizontal size={14} />
              Manage custom fields
            </Link>
          </Card>
```

(`Link` from `next/link` is already imported at the top of this file — no new import needed for it.)

- [x] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

- [x] **Step 3: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/test-cases/page.tsx"
git commit -m "Link to custom fields management from the Test Cases screen"
```

---

### Task 6: Render custom fields in the test case form

**Files:**
- Modify: `src/components/test-cases/test-case-form.tsx`

- [x] **Step 1: Add the type import and a definition interface**

Change:

```ts
import type {
  TestCaseAutomationStatus,
  TestCasePriority,
  TestCaseStatus,
  TestStep,
} from "@/lib/types/database";
```

to:

```ts
import type {
  TestCaseAutomationStatus,
  TestCaseCustomFieldType,
  TestCasePriority,
  TestCaseStatus,
  TestStep,
} from "@/lib/types/database";
```

Then, after the `NEW_FEATURE_VALUE` constant, add:

```ts
export interface CustomFieldDefinition {
  id: string;
  name: string;
  field_type: TestCaseCustomFieldType;
  options: string[];
}
```

- [x] **Step 2: Add `customFieldValues` to `TestCaseFormValues`**

Change:

```ts
export interface TestCaseFormValues {
  title?: string;
  preconditions?: string | null;
  priority?: TestCasePriority;
  status?: TestCaseStatus;
  steps?: TestStep[];
  tags?: string[];
  feature?: string;
  sprintNumber?: number | null;
  assignedTo?: string | null;
  automationStatus?: TestCaseAutomationStatus;
  automationScriptRef?: string | null;
  referenceLink?: string | null;
}
```

to:

```ts
export interface TestCaseFormValues {
  title?: string;
  preconditions?: string | null;
  priority?: TestCasePriority;
  status?: TestCaseStatus;
  steps?: TestStep[];
  tags?: string[];
  feature?: string;
  sprintNumber?: number | null;
  assignedTo?: string | null;
  automationStatus?: TestCaseAutomationStatus;
  automationScriptRef?: string | null;
  referenceLink?: string | null;
  customFieldValues?: Record<string, string>;
}
```

- [x] **Step 3: Add the `customFields` prop**

Change the `TestCaseForm` function signature from:

```ts
export function TestCaseForm({
  action,
  initialValues,
  features,
  orgMembers = [],
  suites,
  defaultSuiteId,
  submitLabel = "Save test case",
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  initialValues?: TestCaseFormValues;
  features: string[];
  orgMembers?: OrgMemberOption[];
  suites?: { id: string; name: string }[];
  defaultSuiteId?: string;
  submitLabel?: string;
}) {
```

to:

```ts
export function TestCaseForm({
  action,
  initialValues,
  features,
  orgMembers = [],
  suites,
  defaultSuiteId,
  customFields = [],
  submitLabel = "Save test case",
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  initialValues?: TestCaseFormValues;
  features: string[];
  orgMembers?: OrgMemberOption[];
  suites?: { id: string; name: string }[];
  defaultSuiteId?: string;
  customFields?: CustomFieldDefinition[];
  submitLabel?: string;
}) {
```

- [x] **Step 4: Render the fields**

Find the block that renders the suite picker (immediately before the `state.error` block):

```tsx
      {suites && suites.length > 0 && (
        <div>
          <Label htmlFor="suiteId">Add to test suite (optional)</Label>
          <Select
            id="suiteId"
            name="suiteId"
            defaultValue={defaultSuiteId ?? ""}
            className="w-full"
          >
            <option value="">None</option>
            {suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {state.error && (
```

Insert a new block between them:

```tsx
      {suites && suites.length > 0 && (
        <div>
          <Label htmlFor="suiteId">Add to test suite (optional)</Label>
          <Select
            id="suiteId"
            name="suiteId"
            defaultValue={defaultSuiteId ?? ""}
            className="w-full"
          >
            <option value="">None</option>
            {suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {customFields.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {customFields.map((field) => (
            <div key={field.id}>
              <Label htmlFor={`customField_${field.id}`}>{field.name}</Label>
              {field.field_type === "select" ? (
                <Select
                  id={`customField_${field.id}`}
                  name={`customField_${field.id}`}
                  defaultValue={initialValues?.customFieldValues?.[field.id] ?? ""}
                  className="w-full"
                >
                  <option value="">—</option>
                  {field.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </Select>
              ) : field.field_type === "number" ? (
                <Input
                  id={`customField_${field.id}`}
                  name={`customField_${field.id}`}
                  type="number"
                  defaultValue={initialValues?.customFieldValues?.[field.id] ?? ""}
                />
              ) : (
                <Input
                  id={`customField_${field.id}`}
                  name={`customField_${field.id}`}
                  defaultValue={initialValues?.customFieldValues?.[field.id] ?? ""}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {state.error && (
```

- [x] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/test-cases/test-case-form.tsx`
Expected: no output.

- [x] **Step 6: Commit**

```bash
git add src/components/test-cases/test-case-form.tsx
git commit -m "Render custom fields in the test case form"
```

---

### Task 7: Fetch and pass custom field definitions from the new/edit pages

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/test-cases/new/page.tsx`
- Modify: `src/app/(app)/projects/[projectId]/test-cases/[testCaseId]/page.tsx`

- [x] **Step 1: Update the "new" page**

In `new/page.tsx`, change the import line:

```ts
import { TestCaseForm } from "@/components/test-cases/test-case-form";
```

to:

```ts
import { TestCaseForm } from "@/components/test-cases/test-case-form";
import type { TestCaseCustomFieldType } from "@/lib/types/database";
```

After the existing `suites` query:

```ts
  const { data: suites } = await supabase
    .from("test_suites")
    .select("id, name")
    .eq("project_id", projectId)
    .order("name");
```

add:

```ts
  const { data: customFieldDefs } = await supabase
    .from("test_case_custom_fields")
    .select("id, name, field_type, options")
    .eq("project_id", projectId)
    .order("display_order")
    .order("created_at");
```

Then update the `<TestCaseForm ... />` call — change:

```tsx
        <TestCaseForm
          action={action}
          submitLabel="Create test case"
          features={(features ?? []).map((f) => f.name)}
          orgMembers={(orgMembers ?? []).map((m) => ({ user_id: m.user_id, email: m.email }))}
          suites={suites ?? []}
          defaultSuiteId={suiteId}
        />
```

to:

```tsx
        <TestCaseForm
          action={action}
          submitLabel="Create test case"
          features={(features ?? []).map((f) => f.name)}
          orgMembers={(orgMembers ?? []).map((m) => ({ user_id: m.user_id, email: m.email }))}
          suites={suites ?? []}
          defaultSuiteId={suiteId}
          customFields={(customFieldDefs ?? []).map((f) => ({
            id: f.id,
            name: f.name,
            field_type: f.field_type as TestCaseCustomFieldType,
            options: (f.options as string[]) ?? [],
          }))}
        />
```

- [x] **Step 2: Update the detail/edit page**

In `[testCaseId]/page.tsx`, change the import line:

```ts
import type { TestStep } from "@/lib/types/database";
```

to:

```ts
import type { TestCaseCustomFieldType, TestStep } from "@/lib/types/database";
```

After the existing `orgMembers` query:

```ts
  const { data: orgMembers } = project
    ? await supabase.rpc("get_org_members", { check_org_id: project.org_id })
    : { data: [] };
```

add:

```ts
  const { data: customFieldDefs } = await supabase
    .from("test_case_custom_fields")
    .select("id, name, field_type, options")
    .eq("project_id", projectId)
    .order("display_order")
    .order("created_at");
```

Then update the `<TestCaseForm ... />` call — change:

```tsx
          <TestCaseForm
            action={updateAction}
            submitLabel="Save changes"
            features={(features ?? []).map((f) => f.name)}
            orgMembers={(orgMembers ?? []).map((m) => ({ user_id: m.user_id, email: m.email }))}
            initialValues={{
              title: testCase.title,
              preconditions: testCase.preconditions,
              priority: testCase.priority,
              status: testCase.status,
              steps: testCase.steps as TestStep[],
              tags: tagNames,
              feature,
              sprintNumber: testCase.sprint_number,
              assignedTo: testCase.assigned_to,
              automationStatus: testCase.automation_status,
              automationScriptRef: testCase.automation_script_ref,
              referenceLink: testCase.reference_link,
            }}
          />
```

to:

```tsx
          <TestCaseForm
            action={updateAction}
            submitLabel="Save changes"
            features={(features ?? []).map((f) => f.name)}
            orgMembers={(orgMembers ?? []).map((m) => ({ user_id: m.user_id, email: m.email }))}
            customFields={(customFieldDefs ?? []).map((f) => ({
              id: f.id,
              name: f.name,
              field_type: f.field_type as TestCaseCustomFieldType,
              options: (f.options as string[]) ?? [],
            }))}
            initialValues={{
              title: testCase.title,
              preconditions: testCase.preconditions,
              priority: testCase.priority,
              status: testCase.status,
              steps: testCase.steps as TestStep[],
              tags: tagNames,
              feature,
              sprintNumber: testCase.sprint_number,
              assignedTo: testCase.assigned_to,
              automationStatus: testCase.automation_status,
              automationScriptRef: testCase.automation_script_ref,
              referenceLink: testCase.reference_link,
              customFieldValues: (testCase.custom_fields as Record<string, string>) ?? {},
            }}
          />
```

- [x] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

- [x] **Step 4: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/test-cases/new/page.tsx" "src/app/(app)/projects/[projectId]/test-cases/[testCaseId]/page.tsx"
git commit -m "Pass custom field definitions and values into the test case form"
```

---

### Task 8: Parse, validate, and persist custom field values

**Files:**
- Modify: `src/lib/actions/test-cases.ts`

- [x] **Step 1: Add the shared parse/validate helper**

After the existing `parseSprintNumber` function (before `export async function createTestCase`), add:

```ts
/** Reads customField_<id> values from the form, validated against this
 * project's current field definitions (fetched fresh here — never trust
 * field ids/types supplied by the client). Returns either the validated
 * values (keyed by field id, ready to store in test_cases.custom_fields)
 * or an error to surface to the user. */
async function parseCustomFieldValues(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  formData: FormData
): Promise<{ values: Record<string, string>; error?: string }> {
  const { data: fields } = await supabase
    .from("test_case_custom_fields")
    .select("id, name, field_type, options")
    .eq("project_id", projectId);

  const values: Record<string, string> = {};
  for (const field of fields ?? []) {
    const raw = formData.get(`customField_${field.id}`);
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value) continue;

    if (field.field_type === "number" && !Number.isFinite(Number(value))) {
      return { values: {}, error: `"${field.name}" must be a number.` };
    }
    if (field.field_type === "select") {
      const options = (field.options as string[]) ?? [];
      if (!options.includes(value)) {
        return { values: {}, error: `"${value}" is not a valid option for "${field.name}".` };
      }
    }
    values[field.id] = value;
  }
  return { values };
}
```

- [x] **Step 2: Wire it into `createTestCase`**

Change:

```ts
  const limitError = await rateLimit("create_test_case", 120, 60);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const featureId = await upsertFeature(supabase, projectId, featureName);
  if (!featureId) return { error: "Could not resolve feature." };

  const { data: testCase, error } = await supabase
    .from("test_cases")
    .insert({
      project_id: projectId,
      title,
      preconditions: preconditions || null,
      priority,
      status,
      steps,
      feature_id: featureId,
      sprint_number: sprintNumber,
      assigned_to: assignedTo,
      automation_status: automationStatus,
      automation_script_ref: automationScriptRef,
      reference_link: referenceLink,
      created_by: ctx.userId,
    })
    .select()
    .single();
```

to:

```ts
  const limitError = await rateLimit("create_test_case", 120, 60);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { values: customFieldValues, error: customFieldError } = await parseCustomFieldValues(
    supabase,
    projectId,
    formData
  );
  if (customFieldError) return { error: customFieldError };

  const featureId = await upsertFeature(supabase, projectId, featureName);
  if (!featureId) return { error: "Could not resolve feature." };

  const { data: testCase, error } = await supabase
    .from("test_cases")
    .insert({
      project_id: projectId,
      title,
      preconditions: preconditions || null,
      priority,
      status,
      steps,
      feature_id: featureId,
      sprint_number: sprintNumber,
      assigned_to: assignedTo,
      automation_status: automationStatus,
      automation_script_ref: automationScriptRef,
      reference_link: referenceLink,
      custom_fields: customFieldValues,
      created_by: ctx.userId,
    })
    .select()
    .single();
```

- [x] **Step 3: Wire it into `updateTestCase`**

Change:

```ts
  const limitError = await rateLimit("update_test_case", 120, 60);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("test_cases")
    .select("*")
    .eq("id", testCaseId)
    .single();

  if (!existing) return { error: "Test case not found." };

  const featureId = await upsertFeature(supabase, projectId, featureName);
  if (!featureId) return { error: "Could not resolve feature." };

  await supabase.from("test_case_versions").insert({
    test_case_id: testCaseId,
    version: existing.version,
    snapshot: existing,
    changed_by: ctx.userId,
  });

  const { error } = await supabase
    .from("test_cases")
    .update({
      title,
      preconditions: preconditions || null,
      priority,
      status,
      steps,
      feature_id: featureId,
      sprint_number: sprintNumber,
      assigned_to: assignedTo,
      automation_status: automationStatus,
      automation_script_ref: automationScriptRef,
      reference_link: referenceLink,
      version: existing.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", testCaseId);
```

to:

```ts
  const limitError = await rateLimit("update_test_case", 120, 60);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { values: customFieldValues, error: customFieldError } = await parseCustomFieldValues(
    supabase,
    projectId,
    formData
  );
  if (customFieldError) return { error: customFieldError };

  const { data: existing } = await supabase
    .from("test_cases")
    .select("*")
    .eq("id", testCaseId)
    .single();

  if (!existing) return { error: "Test case not found." };

  const featureId = await upsertFeature(supabase, projectId, featureName);
  if (!featureId) return { error: "Could not resolve feature." };

  await supabase.from("test_case_versions").insert({
    test_case_id: testCaseId,
    version: existing.version,
    snapshot: existing,
    changed_by: ctx.userId,
  });

  const { error } = await supabase
    .from("test_cases")
    .update({
      title,
      preconditions: preconditions || null,
      priority,
      status,
      steps,
      feature_id: featureId,
      sprint_number: sprintNumber,
      assigned_to: assignedTo,
      automation_status: automationStatus,
      automation_script_ref: automationScriptRef,
      reference_link: referenceLink,
      custom_fields: customFieldValues,
      version: existing.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", testCaseId);
```

- [x] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/test-cases.ts`
Expected: no output.

- [x] **Step 5: Commit**

```bash
git add src/lib/actions/test-cases.ts
git commit -m "Parse, validate, and persist custom field values on create/update"
```

---

### Task 9: List view — badges for custom field values

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/test-cases/page.tsx`

- [ ] **Step 1: Add `custom_fields` to the `TestCaseRow` interface**

Change:

```ts
interface TestCaseRow {
  id: string;
  title: string;
  priority: string;
  status: string;
  sprint_number: number | null;
  assigned_to: string | null;
  test_case_tag_links?: { tag_id: string; test_case_tags: { name: string } | { name: string }[] | null }[];
  test_case_features?: { name: string } | { name: string }[] | null;
}
```

to:

```ts
interface TestCaseRow {
  id: string;
  title: string;
  priority: string;
  status: string;
  sprint_number: number | null;
  assigned_to: string | null;
  custom_fields: Record<string, string> | null;
  test_case_tag_links?: { tag_id: string; test_case_tags: { name: string } | { name: string }[] | null }[];
  test_case_features?: { name: string } | { name: string }[] | null;
}
```

- [ ] **Step 2: Fetch the project's custom field definitions**

After the existing `suites` query:

```ts
  const { data: suites } = await supabase
    .from("test_suites")
    .select("id, name")
    .eq("project_id", projectId)
    .order("name");
```

add:

```ts
  const { data: customFieldDefs } = await supabase
    .from("test_case_custom_fields")
    .select("id, name, field_type, options")
    .eq("project_id", projectId)
    .order("display_order")
    .order("created_at");
```

- [ ] **Step 3: Add `custom_fields` to the main query's `select`**

Change:

```ts
  let query = supabase
    .from("test_cases")
    .select(
      "id, title, priority, status, updated_at, sprint_number, assigned_to, test_case_tag_links(tag_id, test_case_tags(id, name, color)), test_case_features(name)"
    )
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });
```

to:

```ts
  let query = supabase
    .from("test_cases")
    .select(
      "id, title, priority, status, updated_at, sprint_number, assigned_to, custom_fields, test_case_tag_links(tag_id, test_case_tags(id, name, color)), test_case_features(name)"
    )
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });
```

- [ ] **Step 4: Render badges per row**

Find the badge row inside `TestCaseRowItem`:

```tsx
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {groupBy !== "feature" && featureName(tc) && (
              <Badge tone="indigo">{featureName(tc)}</Badge>
            )}
            {groupBy !== "sprint" && tc.sprint_number != null && (
              <Badge tone="blue">Sprint {tc.sprint_number}</Badge>
            )}
            {tc.test_case_tag_links?.map((l) =>
              tagName(l) ? (
                <Badge key={l.tag_id} tone="slate">
                  {tagName(l)}
                </Badge>
              ) : null
            )}
          </div>
```

to:

```tsx
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {groupBy !== "feature" && featureName(tc) && (
              <Badge tone="indigo">{featureName(tc)}</Badge>
            )}
            {groupBy !== "sprint" && tc.sprint_number != null && (
              <Badge tone="blue">Sprint {tc.sprint_number}</Badge>
            )}
            {(customFieldDefs ?? []).map((field) => {
              const value = tc.custom_fields?.[field.id];
              return value ? (
                <Badge key={field.id} tone="slate">
                  {field.name}: {value}
                </Badge>
              ) : null;
            })}
            {tc.test_case_tag_links?.map((l) =>
              tagName(l) ? (
                <Badge key={l.tag_id} tone="slate">
                  {tagName(l)}
                </Badge>
              ) : null
            )}
          </div>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/test-cases/page.tsx"
git commit -m "Show custom field values as badges on the Test Cases list"
```

---

### Task 10: Filter by select-type custom fields

**Files:**
- Modify: `src/components/test-cases/test-case-filters.tsx`
- Modify: `src/app/(app)/projects/[projectId]/test-cases/page.tsx`

- [ ] **Step 1: Add the prop and render loop to `TestCaseFilters`**

Change the function signature:

```ts
export function TestCaseFilters({ tags, features }: { tags: string[]; features: string[] }) {
```

to:

```ts
export interface SelectCustomFieldFilter {
  id: string;
  name: string;
  options: string[];
}

export function TestCaseFilters({
  tags,
  features,
  selectCustomFields = [],
}: {
  tags: string[];
  features: string[];
  selectCustomFields?: SelectCustomFieldFilter[];
}) {
```

Then, after the existing status `Select` block and before the `<div className="h-6 w-px bg-border-light" />` divider:

```tsx
      <Select
        defaultValue={searchParams.get("status") ?? ""}
        onChange={(e) => updateParam("status", e.target.value)}
        className="text-ink-secondary"
      >
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="draft">Draft</option>
        <option value="deprecated">Deprecated</option>
      </Select>
      <div className="h-6 w-px bg-border-light" />
```

becomes:

```tsx
      <Select
        defaultValue={searchParams.get("status") ?? ""}
        onChange={(e) => updateParam("status", e.target.value)}
        className="text-ink-secondary"
      >
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="draft">Draft</option>
        <option value="deprecated">Deprecated</option>
      </Select>
      {selectCustomFields.map((field) => (
        <Select
          key={field.id}
          defaultValue={searchParams.get(`cf_${field.id}`) ?? ""}
          onChange={(e) => updateParam(`cf_${field.id}`, e.target.value)}
          className="text-ink-secondary"
        >
          <option value="">All {field.name}</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      ))}
      <div className="h-6 w-px bg-border-light" />
```

- [ ] **Step 2: Change the page's `searchParams` type to accept arbitrary keys**

In `test-cases/page.tsx`, change:

```ts
export default async function TestCasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    q?: string;
    priority?: string;
    status?: string;
    tag?: string;
    feature?: string;
    groupBy?: string;
    suite?: string;
  }>;
}) {
  const { projectId } = await params;
  const { q, priority, status, tag, feature, groupBy, suite } = await searchParams;
```

to:

```ts
export default async function TestCasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { projectId } = await params;
  const resolvedSearchParams = await searchParams;
  const { q, priority, status, tag, feature, groupBy, suite } = resolvedSearchParams;
```

(Every other later reference to `q`, `priority`, `status`, `tag`, `feature`, `groupBy`, `suite` in this file keeps working unchanged — they're now destructured from `resolvedSearchParams` instead of directly from `searchParams`.)

- [ ] **Step 3: Apply the custom-field filters to the query and pass definitions to `TestCaseFilters`**

Change:

```ts
  if (q) query = query.ilike("title", `%${q}%`);
  if (priority) query = query.eq("priority", priority as TestCasePriority);
  if (status) query = query.eq("status", status as TestCaseStatus);
  if (feature) {
    const matched = (features ?? []).find((f) => f.name === feature);
    query = query.eq("feature_id", matched?.id ?? "00000000-0000-0000-0000-000000000000");
  }
```

to:

```ts
  if (q) query = query.ilike("title", `%${q}%`);
  if (priority) query = query.eq("priority", priority as TestCasePriority);
  if (status) query = query.eq("status", status as TestCaseStatus);
  if (feature) {
    const matched = (features ?? []).find((f) => f.name === feature);
    query = query.eq("feature_id", matched?.id ?? "00000000-0000-0000-0000-000000000000");
  }
  for (const field of customFieldDefs ?? []) {
    const filterValue = resolvedSearchParams[`cf_${field.id}`];
    if (filterValue) {
      query = query.eq(`custom_fields->>${field.id}`, filterValue);
    }
  }
```

(This task assumes Task 9 has already run, so `customFieldDefs` is already fetched above this point in the file. The new `for` loop goes after the existing filter block and before `const { data: testCases } = await query;`.)

Then update the `<TestCaseFilters ... />` call:

```tsx
            <TestCaseFilters
              tags={(tags ?? []).map((t) => t.name)}
              features={(features ?? []).map((f) => f.name)}
            />
```

to:

```tsx
            <TestCaseFilters
              tags={(tags ?? []).map((t) => t.name)}
              features={(features ?? []).map((f) => f.name)}
              selectCustomFields={(customFieldDefs ?? [])
                .filter((f) => f.field_type === "select")
                .map((f) => ({ id: f.id, name: f.name, options: (f.options as string[]) ?? [] }))}
            />
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/test-cases/test-case-filters.tsx "src/app/(app)/projects/[projectId]/test-cases/page.tsx"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/components/test-cases/test-case-filters.tsx "src/app/(app)/projects/[projectId]/test-cases/page.tsx"
git commit -m "Add dropdown filters for select-type custom fields"
```

---

### Task 11: CSV export — dynamic columns

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/test-cases/export/route.ts`

- [ ] **Step 1: Fetch field definitions and add `custom_fields` to the select**

Change:

```ts
  const { data: testCases } = await supabase
    .from("test_cases")
    .select(
      "title, preconditions, priority, status, steps, sprint_number, test_case_tag_links(test_case_tags(name)), test_case_features(name)"
    )
    .eq("project_id", projectId)
    .order("created_at");

  const header = "title,preconditions,priority,status,tags,feature,sprint,steps";
```

to:

```ts
  const { data: customFieldDefs } = await supabase
    .from("test_case_custom_fields")
    .select("id, name")
    .eq("project_id", projectId)
    .order("display_order")
    .order("created_at");

  const { data: testCases } = await supabase
    .from("test_cases")
    .select(
      "title, preconditions, priority, status, steps, sprint_number, custom_fields, test_case_tag_links(test_case_tags(name)), test_case_features(name)"
    )
    .eq("project_id", projectId)
    .order("created_at");

  const customFieldColumns = customFieldDefs ?? [];
  const header = [
    "title",
    "preconditions",
    "priority",
    "status",
    "tags",
    "feature",
    "sprint",
    "steps",
    ...customFieldColumns.map((f) => f.name),
  ].join(",");
```

- [ ] **Step 2: Append custom field values to each row**

Change:

```ts
    return [
      tc.title,
      tc.preconditions ?? "",
      tc.priority,
      tc.status,
      tags,
      feature ?? "",
      tc.sprint_number ?? "",
      encodeSteps((tc.steps as TestStep[]) ?? []),
    ]
      .map((v) => csvEscape(String(v)))
      .join(",");
```

to:

```ts
    const customValues = customFieldColumns.map(
      (f) => (tc.custom_fields as Record<string, string> | null)?.[f.id] ?? ""
    );
    return [
      tc.title,
      tc.preconditions ?? "",
      tc.priority,
      tc.status,
      tags,
      feature ?? "",
      tc.sprint_number ?? "",
      encodeSteps((tc.steps as TestStep[]) ?? []),
      ...customValues,
    ]
      .map((v) => csvEscape(String(v)))
      .join(",");
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/(app)/projects/[projectId]/test-cases/export/route.ts"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/test-cases/export/route.ts"
git commit -m "Add custom field columns to CSV export"
```

---

### Task 12: CSV import — header-based column mapping

**Files:**
- Modify: `src/lib/actions/test-cases.ts`

This is a required behavior change, not just an addition: `bulkImportTestCases` today discards the header row (`const [, ...dataLines] = lines; // skip header`) and destructures columns by fixed position. That breaks the moment column count varies by project. This task switches to reading the header and mapping columns by name.

- [ ] **Step 1: Add header-mapping helpers**

Before `export async function bulkImportTestCases`, add (after the existing `decodeSteps` function):

```ts
function parseHeader(headerLine: string): Map<string, number> {
  const cols = parseCsvLine(headerLine);
  const map = new Map<string, number>();
  cols.forEach((c, i) => map.set(c.trim(), i));
  return map;
}

function col(fields: string[], headerIndex: Map<string, number>, name: string): string {
  const idx = headerIndex.get(name);
  return idx != null ? (fields[idx] ?? "") : "";
}
```

- [ ] **Step 2: Replace the header-skip and fixed-position destructuring**

Change:

```ts
export async function bulkImportTestCases(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a CSV file to import." };

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { error: "CSV file has no rows to import." };

  const [, ...dataLines] = lines; // skip header

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("bulk_import_test_cases", 10, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  for (const line of dataLines) {
    const [title, preconditions, priority, status, tags, feature, sprintRaw, stepsRaw] =
      parseCsvLine(line);
    if (!title) continue;

    const featureId = await upsertFeature(supabase, projectId, feature || "General");
    if (!featureId) continue;

    const parsedSprint = Number.parseInt(sprintRaw, 10);
    const sprintNumber = Number.isFinite(parsedSprint) && parsedSprint >= 0 ? parsedSprint : null;

    const { data: testCase } = await supabase
      .from("test_cases")
      .insert({
        project_id: projectId,
        title,
        preconditions: preconditions || null,
        priority: (priority as TestCasePriority) || "medium",
        status: (status as TestCaseStatus) || "active",
        steps: decodeSteps(stepsRaw),
        feature_id: featureId,
        sprint_number: sprintNumber,
        created_by: ctx.userId,
      })
      .select("id")
      .single();

    if (testCase && tags) {
      const tagNames = tags.split("|").map((t) => t.trim()).filter(Boolean);
      const tagIds = await upsertTags(supabase, projectId, tagNames);
      if (tagIds.length > 0) {
        await supabase
          .from("test_case_tag_links")
          .insert(tagIds.map((tag_id) => ({ test_case_id: testCase.id, tag_id })));
      }
    }
  }

  revalidatePath(`/projects/${projectId}/test-cases`);
  return {};
}
```

to:

```ts
export async function bulkImportTestCases(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a CSV file to import." };

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { error: "CSV file has no rows to import." };

  const [headerLine, ...dataLines] = lines;
  const headerIndex = parseHeader(headerLine);

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("bulk_import_test_cases", 10, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { data: customFieldDefs } = await supabase
    .from("test_case_custom_fields")
    .select("id, name, field_type, options")
    .eq("project_id", projectId);

  for (const line of dataLines) {
    const fields = parseCsvLine(line);
    const title = col(fields, headerIndex, "title");
    if (!title) continue;

    const preconditions = col(fields, headerIndex, "preconditions");
    const priority = col(fields, headerIndex, "priority");
    const status = col(fields, headerIndex, "status");
    const tags = col(fields, headerIndex, "tags");
    const feature = col(fields, headerIndex, "feature");
    const sprintRaw = col(fields, headerIndex, "sprint");
    const stepsRaw = col(fields, headerIndex, "steps");

    const featureId = await upsertFeature(supabase, projectId, feature || "General");
    if (!featureId) continue;

    const parsedSprint = Number.parseInt(sprintRaw, 10);
    const sprintNumber = Number.isFinite(parsedSprint) && parsedSprint >= 0 ? parsedSprint : null;

    // Invalid custom-field values are silently skipped rather than failing
    // the whole row, matching how this import already defaults invalid
    // priority/status instead of rejecting the row outright.
    const customFieldValues: Record<string, string> = {};
    for (const cf of customFieldDefs ?? []) {
      const raw = col(fields, headerIndex, cf.name).trim();
      if (!raw) continue;
      if (cf.field_type === "number" && !Number.isFinite(Number(raw))) continue;
      if (cf.field_type === "select" && !((cf.options as string[]) ?? []).includes(raw)) continue;
      customFieldValues[cf.id] = raw;
    }

    const { data: testCase } = await supabase
      .from("test_cases")
      .insert({
        project_id: projectId,
        title,
        preconditions: preconditions || null,
        priority: (priority as TestCasePriority) || "medium",
        status: (status as TestCaseStatus) || "active",
        steps: decodeSteps(stepsRaw),
        feature_id: featureId,
        sprint_number: sprintNumber,
        custom_fields: customFieldValues,
        created_by: ctx.userId,
      })
      .select("id")
      .single();

    if (testCase && tags) {
      const tagNames = tags.split("|").map((t) => t.trim()).filter(Boolean);
      const tagIds = await upsertTags(supabase, projectId, tagNames);
      if (tagIds.length > 0) {
        await supabase
          .from("test_case_tag_links")
          .insert(tagIds.map((tag_id) => ({ test_case_id: testCase.id, tag_id })));
      }
    }
  }

  revalidatePath(`/projects/${projectId}/test-cases`);
  return {};
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/test-cases.ts`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/test-cases.ts
git commit -m "Switch CSV import to header-based column mapping for custom fields"
```

---

### Task 13: Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/build-status.md`

- [ ] **Step 1: Update README's migration table and feature bullets**

In the migration table, after the `0014` row (or after the last listed migration — check the current last entry before editing), add:

```
| `0015_test_case_custom_fields.sql` | `test_case_custom_fields` — per-project custom field definitions (text/number/select); values stored id-keyed in the pre-existing `test_cases.custom_fields` jsonb column |
```

In the feature bullets under "What's implemented," add to the test case management bullet or as its own line: a mention that custom fields are now supported (project-managed, shown as badges, filterable when `select`-type, and round-tripped through CSV import/export).

- [ ] **Step 2: Update `docs/build-status.md`**

Find the line under "Built but not real yet":

```
| `test_cases.custom_fields` | jsonb column exists in schema, reserved for a future custom-field engine, unused in any UI |
```

Remove that row from the "Built but not real yet" table, and add a bullet under "Shipped and working" → "Test case management" noting custom fields are now implemented (project-managed text/number/select fields, list badges, select-type filters, CSV round-trip).

- [ ] **Step 3: Commit**

```bash
git add README.md docs/build-status.md
git commit -m "Document custom fields on test cases"
```

---

### Task 14: Full verification pass

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Lint the whole repo**

Run: `npx eslint .`
Expected: no output.

- [ ] **Step 3: Production build**

First check for a leftover `next-server` process from a prior build (a recurring issue in this repo):

Run: `lsof -i :3000 -sTCP:LISTEN -t`

If a PID is returned, run `ps -p <pid> -o pid,command` to confirm it's a Meridian `next-server`, then `kill <pid>`.

Then run: `npm run build`
Expected: `✓ Compiled successfully`, all routes listed including the new `/projects/[projectId]/test-cases/custom-fields` route.

- [ ] **Step 4: Supabase security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`.
Expected: the same four pre-existing items only, nothing new.

- [ ] **Step 5: Browser smoke test**

Use `preview_start` with `{name: "meridian-dev"}` (check `.claude/launch.json` for the exact config name used earlier this session), then navigate to `/projects/x/test-cases` and to `/projects/x/test-cases/custom-fields`.
Expected: both redirect cleanly to `/login` (unauthenticated), no console errors, no server errors in `preview_logs`. This is the same limited smoke-test scope used throughout this session, since logging in interactively is out of bounds (credentials are never entered on the user's behalf).

Stop the preview server with `preview_stop` when done, and kill any leftover `next-server` process afterward (check `lsof -i :3000 -sTCP:LISTEN -t` again).

- [ ] **Step 6: Final commit if any verification step required fixes**

If any of the above steps required code changes, commit them now with a message describing what was fixed. If everything passed clean, there's nothing to commit here — the tree should already be clean from Task 13.
