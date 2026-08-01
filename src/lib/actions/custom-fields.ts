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
