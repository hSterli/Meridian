"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import type { TestCasePriority, TestCaseStatus, TestStep } from "@/lib/types/database";
import type { ActionState } from "@/lib/actions/auth";

function parseSteps(raw: string): TestStep[] {
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

    const { data: created } = await supabase
      .from("test_case_tags")
      .insert({ project_id: projectId, name: trimmed })
      .select("id")
      .single();

    if (created) ids.push(created.id);
  }
  return ids;
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

  if (!title) return { error: "Title is required." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const supabase = await createClient();

  const { data: testCase, error } = await supabase
    .from("test_cases")
    .insert({
      project_id: projectId,
      title,
      preconditions: preconditions || null,
      priority,
      status,
      steps,
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

  redirect(`/projects/${projectId}/test-cases/${testCase.id}`);
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

  if (!title) return { error: "Title is required." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("test_cases")
    .select("*")
    .eq("id", testCaseId)
    .single();

  if (!existing) return { error: "Test case not found." };

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
  return {};
}

export async function deleteTestCase(projectId: string, testCaseId: string) {
  const supabase = await createClient();
  await supabase.from("test_cases").delete().eq("id", testCaseId);
  revalidatePath(`/projects/${projectId}/test-cases`);
  redirect(`/projects/${projectId}/test-cases`);
}

function parseCsvLine(line: string): string[] {
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

function decodeSteps(raw: string): TestStep[] {
  if (!raw) return [];
  return raw
    .split(";;")
    .filter(Boolean)
    .map((chunk) => {
      const [step, expected = ""] = chunk.split("|");
      return { step: step ?? "", expected };
    });
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

  const [, ...dataLines] = lines; // skip header

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const supabase = await createClient();

  for (const line of dataLines) {
    const [title, preconditions, priority, status, tags, stepsRaw] = parseCsvLine(line);
    if (!title) continue;

    const { data: testCase } = await supabase
      .from("test_cases")
      .insert({
        project_id: projectId,
        title,
        preconditions: preconditions || null,
        priority: (priority as TestCasePriority) || "medium",
        status: (status as TestCaseStatus) || "active",
        steps: decodeSteps(stepsRaw),
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
