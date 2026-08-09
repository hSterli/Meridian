"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import type {
  TestCaseAutomationStatus,
  TestCasePriority,
  TestCaseStatus,
  TestStep,
} from "@/lib/types/database";
import type { ActionState } from "@/lib/actions/auth";

const AUTOMATION_STATUSES: TestCaseAutomationStatus[] = [
  "manual_only",
  "to_be_automated",
  "automated",
];

function parseAutomationStatus(formData: FormData): TestCaseAutomationStatus {
  const raw = String(formData.get("automationStatus") ?? "manual_only");
  return (AUTOMATION_STATUSES as string[]).includes(raw)
    ? (raw as TestCaseAutomationStatus)
    : "manual_only";
}

export function parseSteps(raw: string): TestStep[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.step === "string")
      .map((s) => ({ step: s.step, expected: s.expected ?? "" }));
  } catch {
    return [];
  }
}

async function upsertTags(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  tagNames: string[]
) {
  const ids: string[] = [];
  for (const name of tagNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const { data: existing } = await supabase
      .from("test_case_tags")
      .select("id")
      .eq("project_id", projectId)
      .eq("name", trimmed)
      .maybeSingle();

    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const { data: created, error } = await supabase
      .from("test_case_tags")
      .insert({ project_id: projectId, name: trimmed })
      .select("id")
      .single();

    if (created) {
      ids.push(created.id);
      continue;
    }

    // Lost a race with a concurrent insert of the same (project_id, name) —
    // the row exists now, so fetch it instead of dropping the tag silently.
    if (error?.code === "23505") {
      const { data: winner } = await supabase
        .from("test_case_tags")
        .select("id")
        .eq("project_id", projectId)
        .eq("name", trimmed)
        .maybeSingle();
      if (winner) ids.push(winner.id);
    }
  }
  return ids;
}

/** Get-or-create a project's feature by name, returning its id. */
async function upsertFeature(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  name: string
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const { data: existing } = await supabase
    .from("test_case_features")
    .select("id")
    .eq("project_id", projectId)
    .eq("name", trimmed)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("test_case_features")
    .insert({ project_id: projectId, name: trimmed })
    .select("id")
    .single();

  if (created) return created.id;

  // Lost a race with a concurrent insert of the same (project_id, name) —
  // the row exists now, so fetch it instead of failing "Could not resolve
  // feature" on a name that does, in fact, now exist.
  if (error?.code === "23505") {
    const { data: winner } = await supabase
      .from("test_case_features")
      .select("id")
      .eq("project_id", projectId)
      .eq("name", trimmed)
      .maybeSingle();
    return winner?.id ?? null;
  }

  return null;
}

/** Resolves the "feature" form field: the `newFeature` text wins when the
 * `feature` select is set to the "add new" sentinel, otherwise the selected
 * existing feature name is used. */
export function resolveFeatureName(formData: FormData): string {
  const selected = String(formData.get("feature") ?? "");
  if (selected === "__new__") {
    return String(formData.get("newFeature") ?? "").trim();
  }
  return selected.trim();
}

export function parseSprintNumber(formData: FormData): number | null {
  const raw = String(formData.get("sprintNumber") ?? "").trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

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

export async function createTestCase(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const preconditions = String(formData.get("preconditions") ?? "").trim();
  const priority = String(formData.get("priority") ?? "medium") as TestCasePriority;
  const status = String(formData.get("status") ?? "active") as TestCaseStatus;
  const steps = parseSteps(String(formData.get("steps") ?? "[]"));
  const tagNames = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const featureName = resolveFeatureName(formData);
  const sprintNumber = parseSprintNumber(formData);
  const assignedTo = String(formData.get("assignedTo") ?? "").trim() || null;
  const automationStatus = parseAutomationStatus(formData);
  const automationScriptRef =
    automationStatus === "manual_only"
      ? null
      : String(formData.get("automationScriptRef") ?? "").trim() || null;
  const referenceLink = String(formData.get("referenceLink") ?? "").trim() || null;
  const suiteId = String(formData.get("suiteId") ?? "").trim() || null;

  if (!title) return { error: "Title is required." };
  if (!featureName) return { error: "Feature is required." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

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

  if (error || !testCase) return { error: error?.message ?? "Could not create test case." };

  if (tagNames.length > 0) {
    const tagIds = await upsertTags(supabase, projectId, tagNames);
    if (tagIds.length > 0) {
      await supabase
        .from("test_case_tag_links")
        .insert(tagIds.map((tag_id) => ({ test_case_id: testCase.id, tag_id })));
    }
  }

  if (suiteId) {
    await supabase
      .from("test_suite_cases")
      .insert({ suite_id: suiteId, test_case_id: testCase.id });
  }

  revalidatePath(`/projects/${projectId}/test-cases`);

  if (suiteId) {
    revalidatePath(`/projects/${projectId}/suites/${suiteId}`);
    redirect(`/projects/${projectId}/suites/${suiteId}`);
  }
  redirect(`/projects/${projectId}/test-cases`);
}

export async function updateTestCase(
  projectId: string,
  testCaseId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const preconditions = String(formData.get("preconditions") ?? "").trim();
  const priority = String(formData.get("priority") ?? "medium") as TestCasePriority;
  const status = String(formData.get("status") ?? "active") as TestCaseStatus;
  const steps = parseSteps(String(formData.get("steps") ?? "[]"));
  const tagNames = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const featureName = resolveFeatureName(formData);
  const sprintNumber = parseSprintNumber(formData);
  const assignedTo = String(formData.get("assignedTo") ?? "").trim() || null;
  const automationStatus = parseAutomationStatus(formData);
  const automationScriptRef =
    automationStatus === "manual_only"
      ? null
      : String(formData.get("automationScriptRef") ?? "").trim() || null;
  const referenceLink = String(formData.get("referenceLink") ?? "").trim() || null;

  if (!title) return { error: "Title is required." };
  if (!featureName) return { error: "Feature is required." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

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

  if (error) return { error: error.message };

  await supabase.from("test_case_tag_links").delete().eq("test_case_id", testCaseId);
  if (tagNames.length > 0) {
    const tagIds = await upsertTags(supabase, projectId, tagNames);
    if (tagIds.length > 0) {
      await supabase
        .from("test_case_tag_links")
        .insert(tagIds.map((tag_id) => ({ test_case_id: testCaseId, tag_id })));
    }
  }

  revalidatePath(`/projects/${projectId}/test-cases/${testCaseId}`);
  revalidatePath(`/projects/${projectId}/test-cases`);
  redirect(`/projects/${projectId}/test-cases`);
}

export async function deleteTestCase(projectId: string, testCaseId: string) {
  const supabase = await createClient();
  await supabase.from("test_cases").delete().eq("id", testCaseId);
  revalidatePath(`/projects/${projectId}/test-cases`);
  redirect(`/projects/${projectId}/test-cases`);
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function decodeSteps(raw: string): TestStep[] {
  if (!raw) return [];
  return raw
    .split(";;")
    .filter(Boolean)
    .map((chunk) => {
      const [step, expected = ""] = chunk.split("|");
      return { step: step ?? "", expected };
    });
}

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
