"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import type { IssueSeverity, IssueStatus } from "@/lib/types/database";
import type { ActionState } from "@/lib/actions/auth";

export async function createIssue(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const severity = String(formData.get("severity") ?? "medium") as IssueSeverity;
  const linkedTestCaseId = String(formData.get("linkedTestCaseId") ?? "") || null;
  const linkedRunCaseId = String(formData.get("linkedRunCaseId") ?? "") || null;

  if (!title) return { error: "Title is required." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const supabase = await createClient();
  const { data: issue, error } = await supabase
    .from("issues")
    .insert({
      project_id: projectId,
      title,
      description: description || null,
      severity,
      linked_test_case_id: linkedTestCaseId,
      linked_run_case_id: linkedRunCaseId,
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (error || !issue) return { error: error?.message ?? "Could not create issue." };

  redirect(`/projects/${projectId}/issues/${issue.id}`);
}

export async function updateIssueStatus(projectId: string, issueId: string, status: IssueStatus) {
  const supabase = await createClient();
  await supabase
    .from("issues")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", issueId);
  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
  revalidatePath(`/projects/${projectId}/issues`);
}

export async function deleteIssue(projectId: string, issueId: string) {
  const supabase = await createClient();
  await supabase.from("issues").delete().eq("id", issueId);
  revalidatePath(`/projects/${projectId}/issues`);
  redirect(`/projects/${projectId}/issues`);
}
